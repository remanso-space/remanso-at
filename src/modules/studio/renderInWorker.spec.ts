import { afterEach, describe, expect, it, vi } from "vitest"

import { renderSession, type TakePcm } from "./assemble"
import { addTake, newSession } from "./edl"
import type { Take } from "./edl.types"
import { renderSessionInWorker } from "./renderInWorker"

const take = (id: string, sec: number): Take => ({
  id,
  opfsPath: `takes/${id}.webm`,
  durationSec: sec,
  peaksPath: `peaks/${id}.bin`,
  flags: [],
  label: id,
})

const sineSession = () => {
  const sr = 48_000
  const s = addTake(newSession("s", "e"), take("t1", 1), "c1")
  const pcm: TakePcm = {
    t1: Float32Array.from({ length: sr }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / sr)),
  }
  return { s, pcm, sr }
}

describe("renderSessionInWorker", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("falls back to the synchronous render when Worker is unavailable, matching it exactly", async () => {
    // jsdom has no module Worker; force the fallback branch explicitly regardless.
    vi.stubGlobal("Worker", undefined)
    const { s, pcm, sr } = sineSession()

    const viaWrapper = await renderSessionInWorker(s, pcm, sr)
    const direct = renderSession(s, pcm, sr)

    expect(viaWrapper.samples.length).toBe(direct.samples.length)
    expect(viaWrapper.durationSec).toBe(direct.durationSec)
    for (let i = 0; i < direct.samples.length; i += 1)
      expect(viaWrapper.samples[i]).toBe(direct.samples[i])
  })

  it("falls back when the Worker constructor throws", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("no worker here")
        }
      },
    )
    const { s, pcm, sr } = sineSession()

    const viaWrapper = await renderSessionInWorker(s, pcm, sr)
    const direct = renderSession(s, pcm, sr)
    expect(viaWrapper.samples.length).toBe(direct.samples.length)
  })
})
