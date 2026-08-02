import { describe, expect, it } from "vitest"

import { encodeWav } from "./wav"

const readStr = (view: DataView, offset: number, length: number) =>
  Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join("")

describe("encodeWav", () => {
  it("writes a well-formed 16-bit mono PCM header for the given rate and length", async () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 1, -1])
    const blob = encodeWav(samples, 48_000)
    expect(blob.type).toBe("audio/wav")

    const view = new DataView(await blob.arrayBuffer())
    expect(readStr(view, 0, 4)).toBe("RIFF")
    expect(readStr(view, 8, 4)).toBe("WAVE")
    expect(readStr(view, 36, 4)).toBe("data")
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(48_000)
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(view.getUint32(40, true)).toBe(samples.length * 2) // data size
    expect(view.byteLength).toBe(44 + samples.length * 2)
  })

  it("clamps and scales full-scale samples without wrapping", async () => {
    const view = new DataView(
      await encodeWav(Float32Array.from([1, -1, 2, -2]), 48_000).arrayBuffer(),
    )
    expect(view.getInt16(44, true)).toBe(0x7fff) // +1 → max positive
    expect(view.getInt16(46, true)).toBe(-0x8000) // −1 → min negative
    expect(view.getInt16(48, true)).toBe(0x7fff) // +2 clamps to +1
    expect(view.getInt16(50, true)).toBe(-0x8000) // −2 clamps to −1
  })
})
