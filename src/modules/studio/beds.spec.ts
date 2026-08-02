import { describe, expect, it } from "vitest"

import { BED_IDS, renderBed, renderBedBuffer } from "./beds"
import type { BedId } from "./edl.types"

const SR = 48_000

const rms = (buf: Float32Array): number => {
  let s = 0
  for (const x of buf) s += x * x
  return Math.sqrt(s / buf.length)
}

const peak = (buf: Float32Array): number => {
  let m = 0
  for (const x of buf) m = Math.max(m, Math.abs(x))
  return m
}

const dbfs = (buf: Float32Array): number => 20 * Math.log10(rms(buf))

// Energy in a frequency band, via a naive DFT at a handful of probe frequencies — enough
// to tell "this bed has bass" from "this bed is all treble" without an FFT dependency.
const bandEnergy = (buf: Float32Array, loHz: number, hiHz: number, sr = SR): number => {
  let total = 0
  const probes = 8
  for (let p = 0; p < probes; p += 1) {
    const hz = loHz + ((hiHz - loHz) * p) / (probes - 1)
    let re = 0
    let im = 0
    for (let i = 0; i < buf.length; i += 1) {
      const ph = (2 * Math.PI * hz * i) / sr
      re += buf[i] * Math.cos(ph)
      im += buf[i] * Math.sin(ph)
    }
    total += (re * re + im * im) / buf.length
  }
  return total / probes
}

describe("renderBed — position-addressability", () => {
  // The property renderChain.spec pins for the chain, pinned here for the engine: a window
  // taken from the middle of the stream is a bit-exact slice of the whole render. Nothing
  // about where you start reading changes the samples.
  for (const bed of BED_IDS) {
    it(`${bed}: a mid-stream window equals the same slice of a full render`, () => {
      const N = 6000
      const whole = renderBedBuffer(bed, 7, 0, N)

      const start = 2000
      const count = 2500
      const window = renderBedBuffer(bed, 7, start, count)

      expect(window.length).toBe(count)
      for (let i = 0; i < count; i += 1) expect(window[i]).toBe(whole[start + i])
    })
  }

  it("is bit-identical across two calls with the same arguments", () => {
    const a = renderBedBuffer("river", 42, 1000, 3000)
    const b = renderBedBuffer("river", 42, 1000, 3000)
    for (let i = 0; i < a.length; i += 1) expect(a[i]).toBe(b[i])
  })

  it("rendering in consecutive windows equals rendering whole", () => {
    const N = 5000
    const whole = renderBedBuffer("wind", 3, 0, N)
    const joined = new Float32Array(N)
    joined.set(renderBedBuffer("wind", 3, 0, 1500), 0)
    joined.set(renderBedBuffer("wind", 3, 1500, 2000), 1500)
    joined.set(renderBedBuffer("wind", 3, 3500, N - 3500), 3500)
    for (let i = 0; i < N; i += 1) expect(joined[i]).toBe(whole[i])
  })

  it("writes exactly `count` samples and respects an offset into a larger buffer", () => {
    const out = new Float32Array(100).fill(9)
    renderBed("pink", 1, 0, 40, out)
    // Only the first 40 are touched; the tail sentinel survives.
    expect(out[99]).toBe(9)
    expect(out[40]).toBe(9)
    expect(out[0]).not.toBe(9)
  })
})

describe("renderBed — seed sensitivity", () => {
  it("different seeds give different streams", () => {
    const a = renderBedBuffer("rain", 1, 0, 4000)
    const b = renderBedBuffer("rain", 2, 0, 4000)
    let same = 0
    for (let i = 0; i < a.length; i += 1) if (a[i] === b[i]) same += 1
    expect(same).toBeLessThan(a.length / 100)
  })
})

describe("renderBed — spectral shape", () => {
  it("brown is bass-heavy: far more low energy than high", () => {
    const buf = renderBedBuffer("brown", 5, 0, SR)
    expect(bandEnergy(buf, 40, 200)).toBeGreaterThan(bandEnergy(buf, 4000, 8000) * 20)
  })

  it("rain is high-passed: little energy below 500 Hz", () => {
    const buf = renderBedBuffer("rain", 5, 0, SR)
    expect(bandEnergy(buf, 1000, 4000)).toBeGreaterThan(bandEnergy(buf, 60, 200) * 4)
  })

  it("river is band-limited: midrange dominates both extremes", () => {
    const buf = renderBedBuffer("river", 5, 0, SR)
    const mid = bandEnergy(buf, 400, 1500)
    expect(mid).toBeGreaterThan(bandEnergy(buf, 40, 120))
    expect(mid).toBeGreaterThan(bandEnergy(buf, 6000, 10000))
  })
})

describe("renderBed — levels", () => {
  it("room tone sits low, roughly -55..-65 dBFS", () => {
    const buf = renderBedBuffer("roomTone", 5, 0, SR)
    const level = dbfs(buf)
    expect(level).toBeLessThan(-50)
    expect(level).toBeGreaterThan(-72)
  })

  it("every bed stays within [-1, 1] and is not silent", () => {
    for (const bed of BED_IDS as BedId[]) {
      const buf = renderBedBuffer(bed, 11, 0, SR)
      expect(peak(buf)).toBeLessThanOrEqual(1)
      expect(rms(buf)).toBeGreaterThan(0)
    }
  })
})
