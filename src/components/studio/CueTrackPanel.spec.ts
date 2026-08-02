import { mount } from "@vue/test-utils"
import { describe, expect, it, vi } from "vitest"

import type { TakeAnalysis } from "../../modules/studio/analyzeTake"
import { addTake, cueTrack, newSession } from "../../modules/studio/edl"
import type { Session, Take } from "../../modules/studio/edl.types"
import CueTrackPanel from "./CueTrackPanel.vue"

// The pure specs cover the EDL ops; this covers the wiring — a button reaches the right op
// and the resulting session leaves as an `edit`.

vi.mock("../../modules/studio/opfsCues", () => ({
  writeCueFile: vi.fn(async () => "cues/x.mp3"),
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

const session = (): Session => addTake(newSession("s", "Episode"), take, "c1")

const mountPanel = (s: Session = session()) =>
  mount(CueTrackPanel, { props: { session: s, analyses: { t1: analysis } } })

describe("CueTrackPanel", () => {
  it("adds a bed as an edit onto the cue track", async () => {
    const w = mountPanel()
    await w.find('[data-test="add-bed"]').trigger("click")

    const edits = w.emitted("edit") as Session[][]
    expect(edits).toHaveLength(1)
    const clip = cueTrack(edits[0][0])!.clips[0]
    expect(clip.source.kind).toBe("bed")
    expect(clip.duck).toBe("under-speech")
  })

  it("fills room tone as an edit", async () => {
    const w = mountPanel()
    await w.find('[data-test="room-tone"]').trigger("click")

    const clip = cueTrack((w.emitted("edit") as Session[][])[0][0])!.clips[0]
    expect(clip.source).toMatchObject({ kind: "bed", bedId: "roomTone" })
  })

  it("surfaces the bitrate tier and reacts to a bed being present", async () => {
    // Start with a music-heavy cue already placed so the tier line is not speech-only.
    const w = mountPanel()
    await w.find('[data-test="add-bed"]').trigger("click")
    const withBed = (w.emitted("edit") as Session[][])[0][0]

    const w2 = mountPanel(withBed)
    expect(w2.find(".tier").text()).toContain("music-heavy")
  })

  it("offers snap targets — a speech onset — as a place-at option", () => {
    const w = mountPanel()
    const options = w.findAll("option").map((o) => o.text())
    expect(options.some((t) => t.startsWith("onset"))).toBe(true)
  })

  it("removes a cue clip", async () => {
    const w = mountPanel()
    await w.find('[data-test="add-bed"]').trigger("click")
    const withBed = (w.emitted("edit") as Session[][])[0][0]

    const w2 = mountPanel(withBed)
    await w2.findAll(".clip .danger")[0].trigger("click")
    const after = (w2.emitted("edit") as Session[][])[0][0]
    expect(cueTrack(after)!.clips).toHaveLength(0)
  })
})
