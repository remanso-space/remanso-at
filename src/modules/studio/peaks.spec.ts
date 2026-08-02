import { describe, expect, it } from "vitest"

import {
  computePeaks,
  decodePeaks,
  encodePeaks,
  peakAtSec,
  peaksForColumns,
  PEAKS_BINS_PER_SEC,
} from "./peaks"

const SR = 48_000

const ramp = (length: number, level: number): Float32Array => {
  const buf = new Float32Array(length)
  buf.fill(level)
  return buf
}

describe("computePeaks", () => {
  it("reduces one second to binsPerSec bins", () => {
    const peaks = computePeaks(ramp(SR, 0.5), SR, 100)

    expect(peaks.binsPerSec).toBe(100)
    expect(peaks.bins).toHaveLength(100)
  })

  it("keeps the absolute peak of each bin, not its mean", () => {
    const samples = new Float32Array(SR / 100)
    samples[0] = -1
    const peaks = computePeaks(samples, SR, 100)

    expect(peaks.bins[0]).toBe(255)
  })

  it("clamps above full scale rather than wrapping", () => {
    const peaks = computePeaks(ramp(SR / 100, 4), SR, 100)

    expect(peaks.bins[0]).toBe(255)
  })

  it("reads silence as zero", () => {
    const peaks = computePeaks(ramp(SR, 0), SR, 100)

    expect([...peaks.bins].every((b) => b === 0)).toBe(true)
  })
})

describe("encodePeaks / decodePeaks", () => {
  it("round-trips the bins and the bin rate", () => {
    const peaks = computePeaks(ramp(SR, 0.25), SR, PEAKS_BINS_PER_SEC)
    const back = decodePeaks(encodePeaks(peaks))

    expect(back?.binsPerSec).toBe(PEAKS_BINS_PER_SEC)
    expect(back && [...back.bins]).toEqual([...peaks.bins])
  })

  it("declines bytes that are not peaks rather than reading garbage", () => {
    expect(decodePeaks(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(decodePeaks(new Uint8Array(16))).toBeNull()
  })

  it("declines a future version", () => {
    const bytes = encodePeaks(computePeaks(ramp(SR, 0.25), SR, 100))
    bytes[2] = 99

    expect(decodePeaks(bytes)).toBeNull()
  })
})

describe("peakAtSec", () => {
  it("reads the bin covering a second", () => {
    const samples = new Float32Array(SR)
    samples[Math.round(0.5 * SR)] = 1
    const peaks = computePeaks(samples, SR, 100)

    expect(peakAtSec(peaks, 0.5)).toBe(1)
    expect(peakAtSec(peaks, 0.1)).toBe(0)
  })

  it("reads out of range as silence", () => {
    const peaks = computePeaks(ramp(SR, 1), SR, 100)

    expect(peakAtSec(peaks, -1)).toBe(0)
    expect(peakAtSec(peaks, 99)).toBe(0)
  })
})

describe("peaksForColumns", () => {
  it("returns one value per column", () => {
    const peaks = computePeaks(ramp(10 * SR, 0.5), SR, 100)

    expect(peaksForColumns(peaks, 10, 700)).toHaveLength(700)
  })

  it("keeps a lone transient visible when the take is squeezed down", () => {
    const samples = new Float32Array(60 * SR)
    samples[Math.round(30 * SR)] = 1
    const columns = peaksForColumns(computePeaks(samples, SR, 100), 60, 100)

    expect(Math.max(...columns)).toBe(1)
  })

  it("repeats the nearest bin when there are fewer bins than columns", () => {
    const peaks = computePeaks(ramp(SR / 10, 1), SR, 100) // 10 bins
    const columns = peaksForColumns(peaks, 0.1, 50)

    expect(columns.every((c) => c === 1)).toBe(true)
  })

  it("returns silence for an empty take", () => {
    expect(peaksForColumns({ binsPerSec: 100, bins: new Uint8Array(0) }, 0, 10)).toEqual(
      Array.from({ length: 10 }).fill(0),
    )
  })
})
