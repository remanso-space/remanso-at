/**
 * Loudness estimation, ITU-R BS.1770 K-weighting.
 *
 * An estimate, not a conformant measurement: a conformant integrated loudness needs every
 * sample, while this measures from an AnalyserNode polled on a timer. Within a decibel or two
 * for a single speaker on one microphone — enough to keep takes level, not enough to certify
 * a master against a broadcast spec.
 */

/** Apple Podcasts' integrated target. Spotify normalises to -14 on its own. */
export const TARGET_LUFS = -16

/**
 * BS.1770's absolute gate. The spec puts it at -70 LUFS, but a browser capture has a higher
 * noise floor than a studio feed.
 */
export const SILENCE_GATE_LUFS = -60

/** Gain the calibration is allowed to apply, either way. */
export const MIN_GAIN_DB = -12
export const MAX_GAIN_DB = 24

interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/**
 * The two K-weighting stages: a high shelf standing in for the head's acoustic response, then
 * a high-pass. Coefficients are derived for the actual sample rate rather than hardcoded for
 * 48 kHz, since a browser may hand back 44.1.
 */
const kWeighting = (sampleRate: number): [Biquad, Biquad] => {
  const shelfF0 = 1681.974450955533
  const shelfGain = 3.999843853973347
  const shelfQ = 0.7071752369554196

  const k = Math.tan((Math.PI * shelfF0) / sampleRate)
  const vh = Math.pow(10, shelfGain / 20)
  const vb = Math.pow(vh, 0.4996667741545416)
  const shelfDen = 1 + k / shelfQ + k * k

  const shelf: Biquad = {
    b0: (vh + (vb * k) / shelfQ + k * k) / shelfDen,
    b1: (2 * (k * k - vh)) / shelfDen,
    b2: (vh - (vb * k) / shelfQ + k * k) / shelfDen,
    a1: (2 * (k * k - 1)) / shelfDen,
    a2: (1 - k / shelfQ + k * k) / shelfDen,
  }

  const hpF0 = 38.13547087602444
  const hpQ = 0.5003270373238773
  const hpK = Math.tan((Math.PI * hpF0) / sampleRate)
  const hpDen = 1 + hpK / hpQ + hpK * hpK

  const highpass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (hpK * hpK - 1)) / hpDen,
    a2: (1 - hpK / hpQ + hpK * hpK) / hpDen,
  }

  return [shelf, highpass]
}

interface BiquadState {
  x1: number
  x2: number
  y1: number
  y2: number
}

const freshState = (): BiquadState => ({ x1: 0, x2: 0, y1: 0, y2: 0 })

const step = (filter: Biquad, state: BiquadState, x: number): number => {
  const y =
    filter.b0 * x +
    filter.b1 * state.x1 +
    filter.b2 * state.x2 -
    filter.a1 * state.y1 -
    filter.a2 * state.y2

  state.x2 = state.x1
  state.x1 = x
  state.y2 = state.y1
  state.y1 = y
  return y
}

export interface LoudnessEstimator {
  /**
   * One window of time-domain samples per channel, -1 to 1. Channels are summed at unity
   * weight the way BS.1770 does it, which is right for left, right and centre.
   */
  push: (...channels: Float32Array[]) => void
  /** Windows loud enough to count as speech. */
  readonly speechWindows: number
  /** Estimated loudness in LUFS, or null before any speech was heard. */
  lufs: () => number | null
}

export const createLoudnessEstimator = (sampleRate: number): LoudnessEstimator => {
  const [shelf, highpass] = kWeighting(sampleRate)
  // Filter state persists across windows, one set per channel. Non-contiguous windows each
  // carry a small discontinuity, negligible against thousands of samples and cheaper than
  // warming the filter up every time.
  const shelfStates: BiquadState[] = []
  const highpassStates: BiquadState[] = []

  const kept: number[] = []

  const loudnessOf = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare)

  const meanLoudness = (squares: number[]) =>
    loudnessOf(squares.reduce((sum, value) => sum + value, 0) / squares.length)

  return {
    push(...channels) {
      let meanSquare = 0

      channels.forEach((window, channel) => {
        if (!window.length) return

        shelfStates[channel] ??= freshState()
        highpassStates[channel] ??= freshState()

        let sum = 0
        for (const sample of window) {
          const filtered = step(
            highpass,
            highpassStates[channel],
            step(shelf, shelfStates[channel], sample),
          )
          sum += filtered * filtered
        }

        meanSquare += sum / window.length
      })

      if (meanSquare <= 0) return
      if (loudnessOf(meanSquare) < SILENCE_GATE_LUFS) return

      kept.push(meanSquare)
    },

    get speechWindows() {
      return kept.length
    },

    lufs() {
      if (!kept.length) return null

      // BS.1770's relative gate. Without it the filters' ringing decaying into the silence
      // after a phrase counts as programme material, dragging the measurement down by a
      // couple of tenths on a take with long pauses.
      const threshold = meanLoudness(kept) - 10
      const gated = kept.filter((square) => loudnessOf(square) >= threshold)

      return gated.length ? meanLoudness(gated) : meanLoudness(kept)
    },
  }
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/**
 * `appliedDb` is the gain the take was already recorded with, so the result is a cumulative
 * offset rather than a fresh guess: -20 LUFS measured on a take that already had +6 dB means
 * the microphone sits at -26. Converges in one step instead of oscillating.
 */
export const nextGainDb = (measuredLufs: number, appliedDb: number, target = TARGET_LUFS): number =>
  clamp(appliedDb + (target - measuredLufs), MIN_GAIN_DB, MAX_GAIN_DB)

export const dbToAmplitude = (db: number): number => Math.pow(10, db / 20)
