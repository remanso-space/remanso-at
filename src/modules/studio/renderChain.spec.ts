import { describe, expect, it } from "vitest"

import { createLoudnessEstimator } from "../../utils/loudness"
import { DEFAULT_CHAIN } from "./edl"
import { createChain, createLimiter, renderProgramme } from "./renderChain"

const SR = 48_000

const tone = (hz: number, amp: number, sec: number, sampleRate = SR): Float32Array => {
  const buf = new Float32Array(Math.round(sec * sampleRate))
  for (let i = 0; i < buf.length; i += 1)
    buf[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate)
  return buf
}

const peak = (buf: Float32Array): number => {
  let m = 0
  for (const x of buf) m = Math.max(m, Math.abs(x))
  return m
}

const rms = (buf: Float32Array): number => {
  let s = 0
  for (const x of buf) s += x * x
  return Math.sqrt(s / buf.length)
}

const measureLufs = (buf: Float32Array): number | null => {
  const est = createLoudnessEstimator(SR)
  for (let i = 0; i < buf.length; i += 4096)
    est.push(buf.subarray(i, Math.min(i + 4096, buf.length)))
  return est.lufs()
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

describe("createChain", () => {
  it("attenuates sub-bass below the 80 Hz high-pass and passes the midrange", () => {
    const chain = () => createChain(DEFAULT_CHAIN, SR)
    const low = chain().process(tone(30, 0.5, 1))
    const mid = chain().process(tone(1000, 0.5, 1))

    expect(rms(low)).toBeLessThan(rms(mid) * 0.5)
    expect(rms(mid)).toBeGreaterThan(0.3)
  })

  it("lifts presence: a 6 kHz tone comes out hotter with a positive shelf", () => {
    const flat = createChain({ ...DEFAULT_CHAIN, presenceDb: 0 }, SR).process(tone(6000, 0.3, 0.5))
    const lifted = createChain({ ...DEFAULT_CHAIN, presenceDb: 6 }, SR).process(
      tone(6000, 0.3, 0.5),
    )

    expect(rms(lifted)).toBeGreaterThan(rms(flat) * 1.2)
  })

  it("is seam-free: filtering in windows equals filtering whole", () => {
    const signal = concat(tone(220, 0.4, 0.05), tone(1000, 0.3, 0.03), tone(4000, 0.2, 0.04))
    const whole = createChain(DEFAULT_CHAIN, SR).process(signal)

    const windowed = createChain(DEFAULT_CHAIN, SR)
    const a = windowed.process(signal.subarray(0, 1000))
    const b = windowed.process(signal.subarray(1000, 2500))
    const c = windowed.process(signal.subarray(2500))
    const joined = concat(a, b, c)

    expect(joined.length).toBe(whole.length)
    for (let i = 0; i < whole.length; i += 1) expect(joined[i]).toBe(whole[i])
  })
})

describe("createLimiter", () => {
  it("holds every output sample at or below the ceiling", () => {
    const ceilingDb = -1
    const ceiling = Math.pow(10, ceilingDb / 20)
    const limiter = createLimiter(ceilingDb, SR)
    const out = concat(limiter.process(tone(500, 1.0, 0.2)), limiter.flush())

    // A hair of tolerance for float rounding; the guarantee is a brick wall.
    expect(peak(out)).toBeLessThanOrEqual(ceiling * 1.0001)
  })

  it("leaves a signal already under the ceiling essentially untouched", () => {
    const limiter = createLimiter(-1, SR)
    const quiet = tone(500, 0.2, 0.1)
    const out = concat(limiter.process(quiet), limiter.flush()).subarray(limiter.lookahead)

    expect(peak(out.subarray(0, quiet.length))).toBeCloseTo(0.2, 2)
  })

  it("is seam-free: limiting in windows equals limiting whole", () => {
    const signal = concat(tone(500, 1.0, 0.05), tone(500, 0.2, 0.05), tone(500, 1.0, 0.05))
    const whole = createLimiter(-1, SR).process(signal)

    const windowed = createLimiter(-1, SR)
    const joined = concat(
      windowed.process(signal.subarray(0, 900)),
      windowed.process(signal.subarray(900, 4000)),
      windowed.process(signal.subarray(4000)),
    )

    for (let i = 0; i < whole.length; i += 1) expect(joined[i]).toBe(whole[i])
  })
})

describe("renderProgramme", () => {
  it("normalises a quiet take up to the -16 LUFS target", () => {
    const input = tone(1000, 0.05, 3) // ~ -30 LUFS
    const result = renderProgramme(input, SR, DEFAULT_CHAIN)

    expect(result.measuredLufs).not.toBeNull()
    expect(result.appliedGainDb).toBeGreaterThan(8)
    expect(measureLufs(result.samples)!).toBeCloseTo(-16, 0)
  })

  it("turns a hot take down to the target and keeps peaks under the ceiling", () => {
    const input = tone(1000, 0.8, 3) // ~ -6 LUFS, peaks near 0 dBFS
    const result = renderProgramme(input, SR, DEFAULT_CHAIN)

    expect(result.appliedGainDb).toBeLessThan(0)
    expect(measureLufs(result.samples)!).toBeCloseTo(-16, 0)
    expect(peak(result.samples)).toBeLessThanOrEqual(Math.pow(10, -1 / 20) * 1.0001)
  })

  it("preserves length and does nothing to a silent take", () => {
    const input = new Float32Array(SR)
    const result = renderProgramme(input, SR, DEFAULT_CHAIN)

    expect(result.samples.length).toBe(input.length)
    expect(result.measuredLufs).toBeNull()
    expect(result.appliedGainDb).toBe(0)
    expect(peak(result.samples)).toBe(0)
  })
})
