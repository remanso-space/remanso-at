import { afterEach, describe, expect, it, vi } from "vitest"

import type { TakePcm } from "./assemble"
import { addTake, newSession } from "./edl"
import type { Take } from "./edl.types"
import { renderToPcm, type RenderProgress } from "./renderToPcm"

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
  return { s, pcm }
}

describe("renderToPcm", () => {
  // jsdom has no module Worker; the render falls back to the synchronous path either way.
  afterEach(() => vi.unstubAllGlobals())

  it("renders supplied PCM without touching a decoder and reports monotonic progress", async () => {
    vi.stubGlobal("Worker", undefined)
    const { s, pcm } = sineSession()
    const seen: RenderProgress[] = []

    const result = await renderToPcm({ session: s, takePcm: pcm, onProgress: (p) => seen.push(p) })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.render.samples.length).toBeGreaterThan(0)
    expect(seen.at(-1)?.fraction).toBe(1)
    for (let i = 1; i < seen.length; i += 1)
      expect(seen[i].fraction).toBeGreaterThanOrEqual(seen[i - 1].fraction)
  })

  it("refuses a session with nothing to render", async () => {
    const empty = newSession("s", "e")
    const result = await renderToPcm({ session: empty })
    expect(result.ok).toBe(false)
  })
})
