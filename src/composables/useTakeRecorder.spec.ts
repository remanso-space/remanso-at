import { effectScope } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useRecordingState } from "./useRecordingState"
import { useTakeRecorder } from "./useTakeRecorder"

// OPFS does not exist in jsdom, so the writer is the one collaborator worth faking. The
// rest (MediaRecorder, getUserMedia) are stubbed on globalThis below.
const writer = {
  path: "takes/test.weba",
  write: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
}

vi.mock("../modules/studio/opfsTakes", () => ({
  createTakeWriter: vi.fn(async () => writer),
}))

class FakeMediaRecorder {
  static isTypeSupported = () => true
  static last: FakeMediaRecorder | null = null

  state: "inactive" | "recording" = "inactive"
  onstop: (() => void) | null = null
  ondataavailable: ((event: { data: { size: number } }) => void) | null = null

  constructor() {
    FakeMediaRecorder.last = this
  }

  start() {
    this.state = "recording"
  }

  /** Mirrors the spec: stopping an inactive recorder is an InvalidStateError. */
  stop() {
    if (this.state === "inactive") throw new DOMException("inactive", "InvalidStateError")
    this.state = "inactive"
    this.onstop?.()
  }
}

const scope = effectScope()

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
  vi.stubGlobal("requestAnimationFrame", () => 0)
  vi.stubGlobal("cancelAnimationFrame", () => {})
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => ({ getTracks: () => [] }),
      enumerateDevices: async () => [],
    },
  })
  useRecordingState().setRecording(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const withRecorder = <T>(fn: (r: ReturnType<typeof useTakeRecorder>) => T): T =>
  scope.run(() => fn(useTakeRecorder())) as T

describe("useTakeRecorder", () => {
  it("raises the app-wide recording flag while a take runs", async () => {
    const { isRecording } = useRecordingState()
    const recorder = withRecorder((r) => r)

    expect(await recorder.start()).toBe(true)
    expect(isRecording.value).toBe(true)

    await recorder.stop()
    expect(isRecording.value).toBe(false)
  })

  // The flag gates the update toast for the whole app, so a stop that throws on the way out
  // would wedge it true and suppress the toast for good.
  it("clears the recording flag when the recorder already went inactive", async () => {
    const { isRecording } = useRecordingState()
    const recorder = withRecorder((r) => r)

    await recorder.start()
    // A mic unplugged mid-take ends the stream and the recorder stops itself.
    FakeMediaRecorder.last!.state = "inactive"

    await expect(recorder.stop()).resolves.toMatchObject({ opfsPath: "takes/test.weba" })
    expect(isRecording.value).toBe(false)
  })

  // A clock left frozen on the last take's length reads as a recorder still running, and
  // it is the wrong number for the next take either way.
  it("returns the clock to 0 when the take stops", async () => {
    // The real loop reschedules itself forever, so collect the frames and run one by hand.
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb))
    const now = vi.spyOn(performance, "now")
    now.mockReturnValueOnce(0) // the take starts at t=0
    now.mockReturnValue(12_000) // …and every reading after it is 12s in
    const recorder = withRecorder((r) => r)

    await recorder.start()
    frames[0]?.(0)
    expect(recorder.elapsedSec.value).toBe(12)

    await expect(recorder.stop()).resolves.toMatchObject({ durationSec: 12 })
    expect(recorder.elapsedSec.value).toBe(0)
    now.mockRestore()
  })

  it("clears the recording flag even when sealing the take file fails", async () => {
    const { isRecording } = useRecordingState()
    writer.close.mockRejectedValueOnce(new Error("quota exceeded"))
    const recorder = withRecorder((r) => r)

    await recorder.start()
    await expect(recorder.stop()).rejects.toThrow("quota exceeded")
    expect(isRecording.value).toBe(false)
  })
})
