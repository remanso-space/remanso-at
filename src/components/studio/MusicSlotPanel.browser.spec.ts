import { describe, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-vue"

import type { TakeAnalysis } from "../../modules/studio/analyzeTake"
import { addTake, newSession } from "../../modules/studio/edl"
import type { Session, Take } from "../../modules/studio/edl.types"
import { addSlot, newSlot } from "../../modules/studio/musicSlots"
import { asPhoneColumn, overflowing, undersizedTargets } from "../../test/mobileLayout"
import MusicSlotPanel from "./MusicSlotPanel.vue"

// The panel's unit spec covers the wiring; this one covers what only a browser knows —
// whether the thing fits on a phone. The two paths an author actually walks are a break
// slot (the row with the most controls in it) and the music finder with real search
// results in it, so those are what gets measured.

const searchMusic = vi.fn()
const fetchToOpfs = vi.fn()

vi.mock("../../modules/studio/openverse", () => ({
  PRESET_QUERIES: ["calm ambient pad", "warm drone", "soft piano", "field recording rain"],
  searchMusic: (...args: unknown[]) => searchMusic(...args),
  fetchToOpfs: (...args: unknown[]) => fetchToOpfs(...args),
}))

const take: Take = {
  id: "t1",
  opfsPath: "takes/t1.weba",
  durationSec: 600,
  peaksPath: "peaks/t1.peaks",
  flags: [{ atTakeSec: 120, kind: "mark" }],
  label: "t1",
}

const analysis: TakeAnalysis = {
  peaks: { binsPerSec: 100, bins: new Uint8Array(60000) },
  silences: [],
  cuts: [],
  onsets: [0, 45, 120],
  lufs: -18,
}

// What Openverse hands back for "cicada": freesound field recordings, whose titles and
// creator handles are long. A layout that only holds for "Pad / someone" is not a layout.
const cicadaResults = [
  {
    id: "cicada-1",
    title: "Cicadas at dusk, Provence, stereo field recording",
    creator: "field_recordist_29",
    durationSec: 184,
    filetype: "flac",
    audioUrl: "https://cdn.freesound.org/previews/1/1.flac",
    credit: {
      title: "Cicadas at dusk, Provence, stereo field recording",
      creator: "field_recordist_29",
      license: "by" as const,
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      sourceUrl: "https://freesound.org/1",
    },
  },
  {
    id: "cicada-2",
    title: "Cicada chorus (summer night, no wind)",
    creator: "ambient_archive",
    durationSec: 320,
    filetype: "mp3",
    audioUrl: "https://cdn.freesound.org/previews/2/2.mp3",
    credit: {
      title: "Cicada chorus (summer night, no wind)",
      creator: "ambient_archive",
      license: "cc0" as const,
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      sourceUrl: "https://freesound.org/2",
    },
  },
]

const session = (): Session => addTake(newSession("s", "Episode"), take, "c1")

/** The panel as a page sees it: a full-width column, nothing else competing for room. */
const mountPanel = (s: Session) => {
  asPhoneColumn()
  return render(MusicSlotPanel, {
    props: { session: s, analyses: { t1: analysis } },
  })
}

describe("MusicSlotPanel on a phone", () => {
  it("keeps a break's controls inside the viewport", async () => {
    const slot = { ...newSlot("break", "m1"), pauseSpeech: true }
    mountPanel(addSlot(session(), slot))

    await expect.element(page.getByText("Pause on")).toBeVisible()

    const panel = document.querySelector(".slots")!
    expect(overflowing(panel)).toEqual([])
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })

  it("keeps the finder and its results inside the viewport when searching cicada", async () => {
    searchMusic.mockResolvedValue({ ok: true, results: cicadaResults })

    const slot = newSlot("break", "m1")
    mountPanel(addSlot(session(), slot))

    await page.getByText("Find music").click()
    await page.getByPlaceholder("Search openly licensed audio").fill("cicada")
    await page.getByRole("button", { name: "Search" }).click()

    await expect.element(page.getByText(/Cicada chorus/)).toBeVisible()
    expect(searchMusic).toHaveBeenCalledWith("cicada")

    const finder = document.querySelector(".finder")!
    expect(overflowing(finder)).toEqual([])
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })

  it("gives every control in a break row a thumb-sized target", async () => {
    const slot = { ...newSlot("break", "m1"), pauseSpeech: true }
    mountPanel(addSlot(session(), slot))

    await expect.element(page.getByText("Pause on")).toBeVisible()

    expect(undersizedTargets(document.querySelector(".slots")!)).toEqual([])
  })
})
