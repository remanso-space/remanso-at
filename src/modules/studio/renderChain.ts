// Plain TypeScript rather than a Web Audio graph, so the chain runs in a Worker. Every stage
// carries its state in plain objects, which makes a one-pass render bit-identical to a
// windowed one — the property the windowed render depends on, pinned by the spec.
//
// The expander and compressor settings on ChainSettings are not wired up yet; the chain is
// HPF + presence shelf, normalise, limit.

import { createLoudnessEstimator, dbToAmplitude } from "../../utils/loudness"
import type { ChainSettings } from "./edl.types"

interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

interface BiquadState {
  x1: number
  x2: number
  y1: number
  y2: number
}

const freshState = (): BiquadState => ({ x1: 0, x2: 0, y1: 0, y2: 0 })

// Direct form I, matching loudness.ts. State persists across windows, so a signal filtered in
// chunks equals the same signal filtered whole.
const step = (f: Biquad, s: BiquadState, x: number): number => {
  const y = f.b0 * x + f.b1 * s.x1 + f.b2 * s.x2 - f.a1 * s.y1 - f.a2 * s.y2
  s.x2 = s.x1
  s.x1 = x
  s.y2 = s.y1
  s.y1 = y
  return y
}

/** RBJ high-pass. */
const designHighpass = (f0: number, sampleRate: number, q = Math.SQRT1_2): Biquad => {
  const w0 = (2 * Math.PI * f0) / sampleRate
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const a0 = 1 + alpha
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

/** RBJ high shelf — the presence lift around a few kHz. */
const designHighShelf = (
  f0: number,
  gainDb: number,
  sampleRate: number,
  q = Math.SQRT1_2,
): Biquad => {
  const a = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * f0) / sampleRate
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const twoSqrtAlpha = 2 * Math.sqrt(a) * alpha
  const a0 = a + 1 - (a - 1) * cos + twoSqrtAlpha
  return {
    b0: (a * (a + 1 + (a - 1) * cos + twoSqrtAlpha)) / a0,
    b1: (-2 * a * (a - 1 + (a + 1) * cos)) / a0,
    b2: (a * (a + 1 + (a - 1) * cos - twoSqrtAlpha)) / a0,
    a1: (2 * (a - 1 - (a + 1) * cos)) / a0,
    a2: (a + 1 - (a - 1) * cos - twoSqrtAlpha) / a0,
  }
}

export interface StreamStage {
  /** Process one window, returning a new buffer of the same length. */
  process: (window: Float32Array) => Float32Array
}

/** Presence at 0 dB is skipped rather than run as a unity shelf. */
export const createChain = (settings: ChainSettings, sampleRate: number): StreamStage => {
  const hpf = designHighpass(settings.hpfHz, sampleRate)
  const hpfState = freshState()
  const shelf =
    settings.presenceDb === 0 ? null : designHighShelf(3000, settings.presenceDb, sampleRate)
  const shelfState = freshState()

  return {
    process(window) {
      const out = new Float32Array(window.length)
      for (let i = 0; i < window.length; i += 1) {
        let y = step(hpf, hpfState, window[i])
        if (shelf) y = step(shelf, shelfState, y)
        out[i] = y
      }
      return out
    },
  }
}

export interface Limiter extends StreamStage {
  /** Look-ahead in samples; the output is delayed by this much. */
  readonly lookahead: number
  /** Drain the delay line at end of stream — returns the final `lookahead` samples. */
  flush: () => Float32Array
}

/**
 * A delay line holds the signal while the gain reacts to the loudest sample within the
 * look-ahead, so reduction is already in place when a peak arrives. Attack is instantaneous
 * and release smoothed, which guarantees every output sample sits at or below the ceiling.
 * A sliding-window max over the look-ahead keeps it O(n).
 */
export const createLimiter = (
  ceilingDb: number,
  sampleRate: number,
  lookaheadSec = 0.005,
  releaseSec = 0.05,
): Limiter => {
  const ceiling = dbToAmplitude(ceilingDb)
  const L = Math.max(1, Math.round(lookaheadSec * sampleRate))
  const releaseCoeff = Math.exp(-1 / (releaseSec * sampleRate))

  const delay = new Float32Array(L)
  let delayIdx = 0
  let gain = 1
  let counter = 0
  // Monotonic-decreasing deque of {n, abs} for the max over the last L inputs.
  const dq: { n: number; abs: number }[] = []

  const pushSample = (x: number): number => {
    const abs = Math.abs(x)
    while (dq.length && dq[dq.length - 1].abs <= abs) dq.pop()
    dq.push({ n: counter, abs })
    while (dq[0].n <= counter - L) dq.shift()

    const outgoing = delay[delayIdx]
    delay[delayIdx] = x
    delayIdx = (delayIdx + 1) % L
    counter += 1

    // Peak over [outgoing .. current] = the outgoing sample plus the look-ahead window.
    const peak = Math.max(Math.abs(outgoing), dq[0].abs)
    const required = peak > ceiling ? ceiling / peak : 1
    gain = required < gain ? required : required + (gain - required) * releaseCoeff
    return outgoing * gain
  }

  return {
    lookahead: L,
    process(window) {
      const out = new Float32Array(window.length)
      for (let i = 0; i < window.length; i += 1) out[i] = pushSample(window[i])
      return out
    },
    flush() {
      const out = new Float32Array(L)
      for (let i = 0; i < L; i += 1) out[i] = pushSample(0)
      return out
    },
  }
}

export interface RenderResult {
  samples: Float32Array
  measuredLufs: number | null
  appliedGainDb: number
}

const LUFS_WINDOW = 4096
const MAX_NORMALIZE_DB = 24
const MIN_NORMALIZE_DB = -24

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Two passes — measure, then apply and limit — because the gain cannot be known until the
 * whole programme has been measured.
 */
export const renderProgramme = (
  input: Float32Array,
  sampleRate: number,
  settings: ChainSettings,
): RenderResult => {
  const chain = createChain(settings, sampleRate)
  const chained = chain.process(input)

  const estimator = createLoudnessEstimator(sampleRate)
  for (let i = 0; i < chained.length; i += LUFS_WINDOW) {
    estimator.push(chained.subarray(i, Math.min(i + LUFS_WINDOW, chained.length)))
  }
  const measuredLufs = estimator.lufs()

  const appliedGainDb =
    measuredLufs === null
      ? 0
      : clamp(settings.targetLufs - measuredLufs, MIN_NORMALIZE_DB, MAX_NORMALIZE_DB)
  const gain = dbToAmplitude(appliedGainDb)

  const scaled = new Float32Array(chained.length)
  for (let i = 0; i < chained.length; i += 1) scaled[i] = chained[i] * gain

  const limiter = createLimiter(settings.limiterCeilingDb, sampleRate)
  const limited = limiter.process(scaled)
  const tail = limiter.flush()

  // The limiter delays by `lookahead`; drop that many leading samples so the output aligns
  // with the input and keeps its length.
  const samples = new Float32Array(input.length)
  const joined = (index: number) =>
    index < limited.length ? limited[index] : tail[index - limited.length]
  for (let i = 0; i < input.length; i += 1) samples[i] = joined(i + limiter.lookahead)

  return { samples, measuredLufs, appliedGainDb }
}
