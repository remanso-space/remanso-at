import { mount } from "@vue/test-utils"
import { beforeAll, describe, expect, it } from "vitest"

import type { TakeAnalysis } from "../../modules/studio/analyzeTake"
import { addTake, newSession } from "../../modules/studio/edl"
import type { Session, Take } from "../../modules/studio/edl.types"
import { addSlot, newSlot } from "../../modules/studio/musicSlots"
import ProgrammeTimeline from "./ProgrammeTimeline.vue"

// The slot ops and snap index have their own pure specs; this covers the spatial wiring the
// bar adds — a click on open track drops a break at that second, the × removes one, and a drag
// re-pins a slot to an absolute second. jsdom has no layout or pointer capture, so both are
// stubbed: a 300 px bar over a 30 s programme makes 10 px = 1 s.

const take: Take = {
  id: "t1",
  opfsPath: "takes/t1.weba",
  durationSec: 30,
  peaksPath: "peaks/t1.peaks",
  flags: [],
  label: "t1",
}

const analysis: TakeAnalysis = {
  peaks: { binsPerSec: 100, bins: new Uint8Array(3000) },
  silences: [],
  cuts: [],
  onsets: [],
  lufs: -18,
}

const session = (): Session => addTake(newSession("s", "Episode"), take, "c1")

beforeAll(() => {
  // jsdom stubs: capture is a no-op, and every bar measures 300 px wide from the left edge.
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
})

const mountBar = (s: Session = session()) => {
  const wrapper = mount(ProgrammeTimeline, {
    props: { session: s, analyses: { t1: analysis } },
    attachTo: document.body,
  })
  const track = wrapper.find(".track").element as HTMLElement
  track.getBoundingClientRect = () => ({ left: 0, width: 300, right: 300 }) as DOMRect
  return wrapper
}

const fire = (wrapper: ReturnType<typeof mountBar>, type: string, clientX: number) =>
  wrapper.find(".track").element.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true }))

const lastEdit = (wrapper: ReturnType<typeof mountBar>): Session => {
  const edits = wrapper.emitted("edit") as Session[][]
  return edits[edits.length - 1][0]
}

describe("ProgrammeTimeline", () => {
  it("drops a break where the bar is clicked", async () => {
    const wrapper = mountBar()

    fire(wrapper, "pointerdown", 150) // 150 px / 300 px * 30 s = 15 s
    fire(wrapper, "pointerup", 150)
    await wrapper.vm.$nextTick()

    const slots = lastEdit(wrapper).musicSlots
    expect(slots).toHaveLength(1)
    expect(slots[0].kind).toBe("break")
    expect(slots[0].anchor).toEqual({ kind: "absolute", atSec: 15 })
  })

  it("removes a slot from its × button", async () => {
    const seeded = addSlot(session(), {
      ...newSlot("break", "b1"),
      anchor: { kind: "absolute", atSec: 5 },
    })
    const wrapper = mountBar(seeded)

    await wrapper.find(".slot .x").trigger("click")

    expect(lastEdit(wrapper).musicSlots).toHaveLength(0)
  })

  it("re-pins a slot to an absolute second when dragged", async () => {
    const seeded = addSlot(session(), {
      ...newSlot("break", "b1"),
      anchor: { kind: "absolute", atSec: 5 },
    })
    const wrapper = mountBar(seeded)

    fire(wrapper, "pointerdown", 70) // 7 s, inside the block's [5, 9] span
    fire(wrapper, "pointermove", 200) // 20 s, minus the 2 s grab offset
    fire(wrapper, "pointerup", 200)
    await wrapper.vm.$nextTick()

    expect(lastEdit(wrapper).musicSlots[0].anchor).toEqual({ kind: "absolute", atSec: 18 })
  })

  it("does not add a break when a drag ends on open track", async () => {
    const wrapper = mountBar()

    fire(wrapper, "pointerdown", 30)
    fire(wrapper, "pointermove", 180) // moved well past the click threshold
    fire(wrapper, "pointerup", 180)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted("edit")).toBeUndefined()
  })
})
