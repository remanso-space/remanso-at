// Kept out of the codec wrapper so they can be unit-tested without a decoder.

/** A single channel is returned as-is, not copied. */
export const downmixToMono = (channels: Float32Array[]): Float32Array => {
  if (channels.length === 0) return new Float32Array(0)
  if (channels.length === 1) return channels[0]
  const length = channels[0].length
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    let sum = 0
    for (const ch of channels) sum += ch[i]
    out[i] = sum / channels.length
  }
  return out
}

/**
 * Linear is good enough here: the source is already band-limited by the capture chain, the
 * ratio is small (device rate to 48 kHz), and the render's own filters sit downstream.
 */
export const resampleLinear = (
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array => {
  if (fromRate === toRate || input.length === 0) return input
  const ratio = fromRate / toRate
  const outLength = Math.round(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const frac = pos - i0
    const a = input[i0]
    const b = i0 + 1 < input.length ? input[i0 + 1] : a
    out[i] = a * (1 - frac) + b * frac
  }
  return out
}
