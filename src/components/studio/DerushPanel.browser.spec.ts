import { describe, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-vue"

import type { TakeAnalysis } from "../../modules/studio/analyzeTake"
import { addTake, newSession } from "../../modules/studio/edl"
import type { Session, Take } from "../../modules/studio/edl.types"
import { asPhoneColumn, overflowing, undersizedTargets } from "../../test/mobileLayout"
import DerushPanel from "./DerushPanel.vue"

// Derush is the panel with the most controls per square centimetre — the transport, the
// flag buttons, the chapter list, the cut review. On a phone it is also the panel an
// author spends the longest in, so this measures whether it fits and can be pressed.

vi.mock("../../modules/studio/opfsTakes", () => ({
  // Null keeps the component off a real object URL; layout is what is measured here.
  readTakeFile: vi.fn(async () => null),
}))

const take: Take = {
  id: "t1",
  opfsPath: "takes/t1.weba",
  durationSec: 620,
  peaksPath: "peaks/t1.peaks",
  flags: [
    { atTakeSec: 42, kind: "mark" },
    { atTakeSec: 301, kind: "retake" },
  ],
  label: "t1",
}

const analysis: TakeAnalysis = {
  peaks: { binsPerSec: 100, bins: new Uint8Array(62000) },
  silences: [{ startSec: 120, endSec: 123, edge: false }],
  cuts: [{ startSec: 120.3, endSec: 122.6 }],
  onsets: [0, 42, 301],
  lufs: -19.4,
}

const session = (): Session => addTake(newSession("s", "Episode"), take, "c1")

const mountPanel = (s: Session = session()) => {
  asPhoneColumn()
  return render(DerushPanel, {
    props: { session: s, analyses: { t1: analysis }, selectedTakeId: "t1", canUndo: true },
  })
}

describe("DerushPanel on a phone", () => {
  it("keeps the whole panel inside the viewport", async () => {
    mountPanel()
    await expect.element(page.getByText("§ — derush")).toBeVisible()

    const panel = document.querySelector(".derush")!
    expect(overflowing(panel)).toEqual([])
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })

  it("gives every control a thumb-sized target", async () => {
    mountPanel()
    await expect.element(page.getByText("§ — derush")).toBeVisible()

    expect(undersizedTargets(document.querySelector(".derush")!)).toEqual([])
  })
})
