import { describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-vue"

import type { TakeAnalysis } from "../../modules/studio/analyzeTake"
import { addTake, newSession } from "../../modules/studio/edl"
import type { Session, Take } from "../../modules/studio/edl.types"
import { addSlot, newSlot } from "../../modules/studio/musicSlots"
import {
  asPhoneColumn,
  overflowing,
  undersizedTargets,
  WCAG_MIN_TARGET,
} from "../../test/mobileLayout"
import ProgrammeTimeline from "./ProgrammeTimeline.vue"

// The timeline is the one surface whose whole job is spatial: a bar the width of the
// column with slots pinned along it. On a phone the column is 390 px wide and a slot's
// handle is what a thumb drags, so both the bar's width and the handles' size are the
// design, not decoration.

const take: Take = {
  id: "t1",
  opfsPath: "takes/t1.weba",
  durationSec: 600,
  peaksPath: "peaks/t1.peaks",
  flags: [],
  label: "t1",
}

const analysis: TakeAnalysis = {
  peaks: { binsPerSec: 100, bins: new Uint8Array(60000) },
  silences: [],
  cuts: [],
  onsets: [],
  lufs: -18,
}

const withBreak = (): Session => {
  const base = addTake(newSession("s", "Episode"), take, "c1")
  const slot = { ...newSlot("break", "m1"), anchor: { kind: "absolute" as const, atSec: 300 } }
  return addSlot(base, slot)
}

const mountBar = () => {
  asPhoneColumn()
  return render(ProgrammeTimeline, { props: { session: withBreak(), analyses: { t1: analysis } } })
}

describe("ProgrammeTimeline on a phone", () => {
  it("keeps the bar and its slots inside the viewport", async () => {
    mountBar()
    await expect.element(page.getByText("§ — programme")).toBeVisible()

    const panel = document.querySelector(".timeline-panel")!
    expect(overflowing(panel)).toEqual([])
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })

  // The bar is 44 px tall, so a control inside a slot block cannot also be 44 px — the
  // full-size way to drop a slot is the music panel's "Remove". WCAG's minimum still has
  // to hold, and a block short enough to clip its × away is what that catches.
  it("keeps a slot's remove target at the WCAG minimum even for a 4 s break", async () => {
    mountBar()
    await expect.element(page.getByText("§ — programme")).toBeVisible()

    const panel = document.querySelector(".timeline-panel")!
    expect(undersizedTargets(panel, WCAG_MIN_TARGET)).toEqual([])

    // Laid out is not the same as reachable: the block clips its overflow, so a × pushed
    // past the block's right edge by the label measures 24 px and is still invisible.
    const block = panel.querySelector(".slot")!.getBoundingClientRect()
    const x = panel.querySelector(".slot .x")!.getBoundingClientRect()
    expect(x.right).toBeLessThanOrEqual(block.right + 0.5)
    expect(x.left).toBeGreaterThanOrEqual(block.left - 0.5)
  })

  // The counterpart to the rule above: dropping the label is for blocks with no room for
  // it, and a slot wide enough still has to say what it is.
  it("still labels a slot with room for its name", async () => {
    asPhoneColumn()
    const base = addTake(newSession("s", "Episode"), take, "c1")
    const long = { ...newSlot("intro", "m1"), lengthSec: 240 }
    render(ProgrammeTimeline, {
      props: { session: addSlot(base, long), analyses: { t1: analysis } },
    })

    await expect.element(page.getByText("intro")).toBeVisible()
  })
})
