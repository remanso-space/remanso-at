import { describe, expect, it } from "vitest"

import { downmixToMono, resampleLinear } from "./pcm"

describe("downmixToMono", () => {
  it("returns the single channel untouched", () => {
    const ch = Float32Array.from([1, 2, 3])
    expect(downmixToMono([ch])).toBe(ch)
  })

  it("averages stereo to mono", () => {
    const out = downmixToMono([Float32Array.from([1, 0, -1]), Float32Array.from([0, 1, 1])])
    expect(Array.from(out)).toEqual([0.5, 0.5, 0])
  })

  it("handles no channels", () => {
    expect(downmixToMono([]).length).toBe(0)
  })
})

describe("resampleLinear", () => {
  it("returns the input unchanged at an equal rate", () => {
    const input = Float32Array.from([0, 1, 2])
    expect(resampleLinear(input, 48_000, 48_000)).toBe(input)
  })

  it("roughly halves the length when downsampling 2:1", () => {
    const input = Float32Array.from({ length: 100 }, (_, i) => i)
    const out = resampleLinear(input, 48_000, 24_000)
    expect(out.length).toBe(50)
    expect(out[0]).toBeCloseTo(0, 5)
    expect(out[10]).toBeCloseTo(20, 5) // pos = 10 * 2 = 20
  })

  it("interpolates linearly when upsampling 1:2", () => {
    const out = resampleLinear(Float32Array.from([0, 10]), 24_000, 48_000)
    expect(out.length).toBe(4)
    expect(out[0]).toBeCloseTo(0, 5)
    expect(out[1]).toBeCloseTo(5, 5) // pos = 0.5 → midpoint of 0 and 10
    expect(out[2]).toBeCloseTo(10, 5)
  })

  it("holds the last sample rather than reading past the end", () => {
    const out = resampleLinear(Float32Array.from([0, 4]), 24_000, 48_000)
    expect(out[out.length - 1]).toBeCloseTo(4, 5)
  })
})
