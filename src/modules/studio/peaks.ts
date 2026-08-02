// The peaks pass: the take's amplitude reduced to one byte per bin, so the review
// waveform draws from a few kilobytes instead of decoding an hour of audio every time a
// component mounts (plan: derush, "waveform + markers"). Computed once when a take is
// analysed and parked in OPFS next to the take (`take.peaksPath`).
//
// One byte per bin is deliberate: a waveform is 100 px tall at best, so 8 bits of
// amplitude is already more resolution than the screen has, and 100 bins/second keeps a
// forty-minute take under a quarter of a megabyte.

export const PEAKS_BINS_PER_SEC = 100

/** Absolute peak per bin, 0-255, at `binsPerSec` bins to the second. */
export interface Peaks {
  binsPerSec: number
  bins: Uint8Array
}

export const computePeaks = (
  samples: Float32Array,
  sampleRate: number,
  binsPerSec = PEAKS_BINS_PER_SEC,
): Peaks => {
  const perBin = Math.max(1, Math.round(sampleRate / binsPerSec))
  const count = Math.ceil(samples.length / perBin)
  const bins = new Uint8Array(count)

  for (let bin = 0; bin < count; bin += 1) {
    const start = bin * perBin
    const end = Math.min(start + perBin, samples.length)
    let peak = 0
    for (let i = start; i < end; i += 1) {
      const v = Math.abs(samples[i])
      if (v > peak) peak = v
    }
    bins[bin] = Math.round(Math.min(1, peak) * 255)
  }

  return { binsPerSec, bins }
}

// "RM" + version + reserved + binsPerSec, little-endian, then the bins. The header exists
// so a future change to the bin rate cannot silently misread files written today.
const MAGIC = 0x4d52
const VERSION = 1
const HEADER_BYTES = 8

// Typed as ArrayBuffer-backed, not ArrayBufferLike: the OPFS writer will not take a view
// that might sit on a SharedArrayBuffer, and this one never does.
export const encodePeaks = ({ binsPerSec, bins }: Peaks): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(HEADER_BYTES + bins.length)
  const view = new DataView(out.buffer)
  view.setUint16(0, MAGIC, true)
  view.setUint8(2, VERSION)
  view.setUint8(3, 0)
  view.setUint32(4, binsPerSec, true)
  out.set(bins, HEADER_BYTES)
  return out
}

/** Null for anything this version cannot read — the caller recomputes rather than guesses. */
export const decodePeaks = (bytes: Uint8Array): Peaks | null => {
  if (bytes.length < HEADER_BYTES) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint16(0, true) !== MAGIC) return null
  if (view.getUint8(2) !== VERSION) return null
  const binsPerSec = view.getUint32(4, true)
  if (binsPerSec <= 0) return null
  return { binsPerSec, bins: bytes.slice(HEADER_BYTES) }
}

/** Peak at a take second, 0-1. Out of range reads as silence. */
export const peakAtSec = ({ binsPerSec, bins }: Peaks, sec: number): number => {
  const bin = Math.floor(sec * binsPerSec)
  if (bin < 0 || bin >= bins.length) return 0
  return bins[bin] / 255
}

/**
 * The loudest peak in each of `columns` equal slices of [0, durationSec] — one value per
 * pixel column of the waveform. Reducing by max (not by mean) keeps a single loud
 * transient visible when a forty-minute take is squeezed into 700 pixels; when there are
 * fewer bins than columns the nearest bin is repeated, so a short take draws a stepped
 * waveform rather than a comb of gaps.
 */
export const peaksForColumns = (peaks: Peaks, durationSec: number, columns: number): number[] => {
  const out = Array.from<number>({ length: Math.max(0, columns) }).fill(0)
  if (columns <= 0 || durationSec <= 0 || peaks.bins.length === 0) return out

  const binsPerColumn = (durationSec * peaks.binsPerSec) / columns
  for (let column = 0; column < columns; column += 1) {
    const from = Math.floor(column * binsPerColumn)
    const to = Math.max(from + 1, Math.floor((column + 1) * binsPerColumn))
    let peak = 0
    for (let bin = from; bin < to && bin < peaks.bins.length; bin += 1) {
      if (peaks.bins[bin] > peak) peak = peaks.bins[bin]
    }
    out[column] = peak / 255
  }
  return out
}
