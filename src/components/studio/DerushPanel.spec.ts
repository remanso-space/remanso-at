import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { TakeAnalysis } from "../../modules/studio/analyzeTake"
import { addTake, newSession, speechTrack } from "../../modules/studio/edl"
import type { Session, Take } from "../../modules/studio/edl.types"
import DerushPanel from "./DerushPanel.vue"

// The keyboard is the derush interface, so this covers the wiring the pure specs cannot:
// a key reaches the right pure function, the resulting EDL leaves as an `edit`, and keys
// stay out of the way while you are typing a title.

vi.mock("../../modules/studio/opfsTakes", () => ({
  // Null keeps the component off URL.createObjectURL, which jsdom does not have.
  readTakeFile: vi.fn(async () => null),
}))

const take: Take = {
  id: "t1",
  opfsPath: "takes/t1.weba",
  durationSec: 10,
  peaksPath: "peaks/t1.peaks",
  flags: [
    { atTakeSec: 3, kind: "mark" },
    { atTakeSec: 7, kind: "retake" },
  ],
  label: "t1",
}

const analysis: TakeAnalysis = {
  peaks: { binsPerSec: 100, bins: new Uint8Array(1000) },
  silences: [],
  cuts: [{ startSec: 8.5, endSec: 9 }],
  onsets: [0, 5],
  lufs: -19.4,
}

const session = (): Session => addTake(newSession("s", "Episode"), take, "c1")

const mountPanel = () =>
  mount(DerushPanel, {
    props: {
      session: session(),
      analyses: { t1: analysis },
      selectedTakeId: "t1",
      canUndo: true,
    },
    global: { stubs: { TakeWaveform: true } },
    attachTo: document.body,
  })

const press = async (key: string, init: KeyboardEventInit = {}) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }))
  await Promise.resolve()
}

const seekTo = async (wrapper: ReturnType<typeof mountPanel>, sec: number) => {
  wrapper.findComponent({ name: "TakeWaveform" }).vm.$emit("seek", sec)
  await wrapper.vm.$nextTick()
}

const editedClips = (wrapper: ReturnType<typeof mountPanel>) => {
  const events = wrapper.emitted("edit")
  expect(events).toBeTruthy()
  return speechTrack(events!.at(-1)![0] as Session).clips.map((c) => [c.inSec, c.outSec])
}

describe("DerushPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("I, O then X reject the region between the marks", async () => {
    const wrapper = mountPanel()

    await seekTo(wrapper, 2)
    await press("i")
    await seekTo(wrapper, 6)
    await press("o")
    await press("x")

    expect(editedClips(wrapper)).toEqual([
      [0, 2],
      [6, 10],
    ])
  })

  it("rejects nothing when out is not past in", async () => {
    const wrapper = mountPanel()

    await seekTo(wrapper, 6)
    await press("i")
    await press("x")

    expect(wrapper.emitted("edit")).toBeUndefined()
  })

  it("jumps the playhead between flags with [ and ]", async () => {
    const wrapper = mountPanel()

    await press("]")
    expect(wrapper.text()).toContain("0:03")

    await press("]")
    expect(wrapper.text()).toContain("0:07")

    await press("[")
    expect(wrapper.text()).toContain("0:03")
  })

  it("turns the retake flag into a cut of the line that preceded it", async () => {
    const wrapper = mountPanel()

    await wrapper.find("[data-test=cut-retakes]").trigger("click")

    // The retake at 7 s condemns back to the speech onset at 5 s.
    expect(editedClips(wrapper)).toEqual([
      [0, 5],
      [7, 10],
    ])
  })

  it("accepts every pause candidate at once", async () => {
    const wrapper = mountPanel()

    await wrapper.find("[data-test=remove-pauses]").trigger("click")

    expect(editedClips(wrapper)).toEqual([
      [0, 8.5],
      [9, 10],
    ])
  })

  it("drops a chapter against the take at the playhead on C", async () => {
    const wrapper = mountPanel()

    await seekTo(wrapper, 4)
    await press("c")

    const chapters = (wrapper.emitted("edit")!.at(-1)![0] as Session).chapters
    expect(chapters).toEqual([{ takeId: "t1", atTakeSec: 4 }])
  })

  it("asks for undo on ctrl-Z", async () => {
    const wrapper = mountPanel()

    await press("z", { ctrlKey: true })

    expect(wrapper.emitted("undo")).toHaveLength(1)
  })

  it("keeps its hands off the keyboard while you are typing", async () => {
    const wrapper = mountPanel()
    const input = document.createElement("input")
    document.body.append(input)
    input.focus()

    await seekTo(wrapper, 2)
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }))
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "]", bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted("edit")).toBeUndefined()
    expect(wrapper.text()).toContain("0:02")
  })
})
