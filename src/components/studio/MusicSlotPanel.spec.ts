import { mount } from "@vue/test-utils"
import { describe, expect, it, vi } from "vitest"

import type { TakeAnalysis } from "../../modules/studio/analyzeTake"
import { addChapter, addTake, newSession } from "../../modules/studio/edl"
import type { MusicPick, Session, Take } from "../../modules/studio/edl.types"
import { addSlot, fillSlot, newSlot } from "../../modules/studio/musicSlots"
import MusicSlotPanel from "./MusicSlotPanel.vue"

const searchMusic = vi.fn()
const fetchToOpfs = vi.fn()

vi.mock("../../modules/studio/openverse", () => ({
  PRESET_QUERIES: ["calm ambient pad", "warm drone"],
  searchMusic: (...args: unknown[]) => searchMusic(...args),
  fetchToOpfs: (...args: unknown[]) => fetchToOpfs(...args),
}))

const take: Take = {
  id: "t1",
  opfsPath: "takes/t1.weba",
  durationSec: 30,
  peaksPath: "peaks/t1.peaks",
  flags: [{ atTakeSec: 4, kind: "mark" }],
  label: "t1",
}

const analysis: TakeAnalysis = {
  peaks: { binsPerSec: 100, bins: new Uint8Array(3000) },
  silences: [],
  cuts: [],
  onsets: [0, 5, 12],
  lufs: -18,
}

const result = {
  id: "abc",
  title: "Pad",
  creator: "someone",
  durationSec: 30,
  filetype: "mp3",
  audioUrl: "https://cdn.freesound.org/previews/1/1.mp3",
  credit: {
    title: "Pad",
    creator: "someone",
    license: "by" as const,
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourceUrl: "https://freesound.org/1",
  },
}

const pick: MusicPick = {
  opfsPath: "cues/abc.mp3",
  sourceDurationSec: 30,
  credit: result.credit,
}

const session = (): Session => addTake(newSession("s", "Episode"), take, "c1")

const mountPanel = (s: Session = session()) =>
  mount(MusicSlotPanel, { props: { session: s, analyses: { t1: analysis } } })

const lastEdit = (w: ReturnType<typeof mountPanel>): Session => {
  const edits = w.emitted("edit") as Session[][]
  return edits[edits.length - 1][0]
}

describe("MusicSlotPanel", () => {
  it("adds a slot of each kind with its own defaults", async () => {
    const w = mountPanel()
    await w.find('[data-test="add-intro"]').trigger("click")
    const intro = lastEdit(w).musicSlots[0]
    expect(intro.kind).toBe("intro")
    expect(intro.duck).toBe(false)
    expect(intro.pick).toBeNull()

    const w2 = mountPanel()
    await w2.find('[data-test="add-break"]').trigger("click")
    expect(lastEdit(w2).musicSlots[0].duck).toBe(true)
  })

  it("will not offer a slot before there is anything to put music under", () => {
    const w = mountPanel(newSession("s", "Episode"))
    expect(w.find('[data-test="add-intro"]').attributes("disabled")).toBeDefined()
  })

  it("searches on a preset chip and fills the slot with what was picked", async () => {
    searchMusic.mockResolvedValue({ ok: true, results: [result] })
    fetchToOpfs.mockResolvedValue(pick)

    const slot = newSlot("intro", "m1")
    const w = mountPanel(addSlot(session(), slot))

    await w.find(`[data-test="find-${slot.id}"]`).trigger("click")
    await w.find(".chip").trigger("click")
    await w.vm.$nextTick()

    expect(searchMusic).toHaveBeenCalledWith("calm ambient pad")
    expect(w.findAll(".result").length).toBe(1)

    const use = w.findAll(".result button").at(-1)!
    await use.trigger("click")
    await w.vm.$nextTick()

    expect(fetchToOpfs).toHaveBeenCalledWith(result)
    expect(lastEdit(w).musicSlots[0].pick).toEqual(pick)
  })

  it("says so when the search is rate limited rather than showing nothing", async () => {
    searchMusic.mockResolvedValue({
      ok: false,
      error: "Too many searches — try again in a minute.",
    })

    const slot = newSlot("intro", "m1")
    const w = mountPanel(addSlot(session(), slot))
    await w.find(`[data-test="find-${slot.id}"]`).trigger("click")
    await w.find(".chip").trigger("click")
    await w.vm.$nextTick()

    expect(w.find(".error").text()).toContain("minute")
  })

  it("shows the credit of a filled slot with a link to its licence", () => {
    const slot = newSlot("intro", "m1")
    const filled = fillSlot(addSlot(session(), slot), slot.id, pick)
    const w = mountPanel(filled)

    expect(w.text()).toContain("Pad")
    expect(w.text()).toContain("CC BY")
    expect(w.find(".meta a").attributes("href")).toBe(result.credit.licenseUrl)
  })

  it("offers the start, a speech onset, a chapter and the speech end as anchors", () => {
    const slot = newSlot("intro", "m1")
    const withChapter = addChapter(addSlot(session(), slot), {
      takeId: "t1",
      atTakeSec: 12,
      title: "Two",
    })
    const options = mountPanel(withChapter)
      .findAll("option")
      .map((o) => o.text())

    expect(options[0]).toContain("start")
    expect(options.some((o) => o.includes("onset"))).toBe(true)
    expect(options.some((o) => o.includes("chapter 1"))).toBe(true)
    expect(options.at(-1)).toContain("after the last word")
  })

  it("changes a slot's length through the one write path", async () => {
    const slot = newSlot("intro", "m1")
    const w = mountPanel(addSlot(session(), slot))
    const input = w.find('input[type="number"]')
    await input.setValue("14")

    expect(lastEdit(w).musicSlots[0].lengthSec).toBe(14)
  })

  it("says a slot lands nowhere when its chapter was edited out", () => {
    const slot = newSlot("break", "m1")
    const filled = fillSlot(addSlot(session(), slot), slot.id, pick)
    expect(mountPanel(filled).text()).toContain("its chapter was edited out")
  })

  it("surfaces the bitrate tier the music puts the encode in", () => {
    expect(mountPanel().find(".tier").text()).toContain("speech only")

    // An 8 s intro over a 30 s take covers more than a quarter of it.
    const slot = newSlot("intro", "m1")
    const filled = fillSlot(addSlot(session(), slot), slot.id, pick)
    expect(mountPanel(filled).find(".tier").text()).toContain("music-heavy")
  })

  it("removes a slot", async () => {
    const slot = newSlot("intro", "m1")
    const w = mountPanel(addSlot(session(), slot))
    await w.find(".btn.danger").trigger("click")

    expect(lastEdit(w).musicSlots).toEqual([])
  })
})
