import { describe, expect, it } from "vitest"

import { analyzeDecoded } from "./analyzeTake"

const SR = 48_000

const seg = (sec: number, level: number): Float32Array => {
  const buf = new Float32Array(Math.round(sec * SR))
  buf.fill(level)
  return buf
}

const concat = (...parts: Float32Array[]): Float32Array => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const SPEECH = 0.3
const QUIET = 0

describe("analyzeDecoded", () => {
  const buf = concat(seg(1, QUIET), seg(2, SPEECH), seg(1.5, QUIET), seg(2, SPEECH))

  it("draws peaks, cut candidates and onsets from one decode", () => {
    const a = analyzeDecoded(buf, SR, 100)

    expect(a.peaks.bins).toHaveLength(Math.ceil(6.5 * 100))
    expect(a.cuts.length).toBeGreaterThan(0)
    expect(a.onsets[0]).toBeCloseTo(1, 1)
  })

  it("agrees with itself: every cut starts inside a detected silence", () => {
    const a = analyzeDecoded(buf, SR, 100)

    for (const cut of a.cuts) {
      expect(
        a.silences.some((s) => cut.startSec >= s.startSec - 1e-6 && cut.endSec <= s.endSec + 1e-6),
      ).toBe(true)
    }
  })

  it("measures the raw take's loudness", () => {
    const a = analyzeDecoded(buf, SR, 100)

    expect(a.lufs).not.toBeNull()
    expect(a.lufs!).toBeLessThan(0)
  })

  it("reports no loudness for a silent take rather than negative infinity", () => {
    expect(analyzeDecoded(seg(1, QUIET), SR, 100).lufs).toBeNull()
  })
})
