// Reads a decoded take and emits *edits*, never processed audio. Every cut is a proposal the
// review UI can reject individually; nothing here removes audio on its own.

export interface Silence {
  startSec: number
  endSec: number
  /** Touches the very start or end of the take — head/tail, cut fully rather than shortened. */
  edge: boolean
}

export interface Cut {
  startSec: number
  endSec: number
}

export interface PauseOptions {
  /** RMS window; 20 ms is short enough to catch a gap, long enough to be stable. */
  frameSec: number
  /** dB above the noise floor at which silence is declared (the lower hysteresis edge). */
  silenceMarginDb: number
  /** dB above the floor at which speech resumes (the upper edge; must exceed silence). */
  speechMarginDb: number
  /** Silences shorter than this are the rhythm of speech, not pauses — left alone. */
  minPauseSec: number
  /** An interior pause is shortened to this; a comma's worth of breath. */
  targetGapSec: number
  /** The floor is the Nth percentile of frame energy — robust when most of the take is speech. */
  floorPercentile: number
}

export const DEFAULT_PAUSE_OPTIONS: PauseOptions = {
  frameSec: 0.02,
  silenceMarginDb: 6,
  speechMarginDb: 14,
  minPauseSec: 0.5,
  targetGapSec: 0.35,
  floorPercentile: 0.1,
}

const FLOOR_DB = -100

const frameDb = (samples: Float32Array, start: number, length: number): number => {
  let sum = 0
  const end = Math.min(start + length, samples.length)
  for (let i = start; i < end; i += 1) sum += samples[i] * samples[i]
  const n = end - start
  if (n === 0) return FLOOR_DB
  const rms = Math.sqrt(sum / n)
  return rms > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB
}

/** dBFS per frame. Exported so the waveform and analysis overlays reuse the same envelope. */
export const rmsEnvelopeDb = (
  samples: Float32Array,
  sampleRate: number,
  frameSec: number,
): number[] => {
  const frame = Math.max(1, Math.round(frameSec * sampleRate))
  const out: number[] = []
  for (let start = 0; start < samples.length; start += frame) {
    out.push(frameDb(samples, start, frame))
  }
  return out
}

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return FLOOR_DB
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[index]
}

/**
 * Two-threshold hysteresis, so a single quiet frame inside speech does not open a spurious
 * pause and a single loud frame inside a pause does not close one. Thresholds sit above the
 * measured noise floor rather than a fixed dBFS, so a quiet room and a loud one both work.
 */
export const detectSilences = (
  samples: Float32Array,
  sampleRate: number,
  options: Partial<PauseOptions> = {},
): Silence[] => {
  const opt = { ...DEFAULT_PAUSE_OPTIONS, ...options }
  const env = rmsEnvelopeDb(samples, sampleRate, opt.frameSec)
  if (env.length === 0) return []

  const floor = percentile(env, opt.floorPercentile)
  // Guard against the floor landing on speech (a take that is nearly all talk, so its low
  // percentile is still voice). Without spread to seat both thresholds below the speech
  // level they would rise above it and mark speech as silence, cutting into words. Propose
  // nothing instead.
  let maxDb = env[0]
  for (let i = 1; i < env.length; i += 1) if (env[i] > maxDb) maxDb = env[i]
  if (maxDb - floor < opt.speechMarginDb) return []

  const silenceThresh = floor + opt.silenceMarginDb
  const speechThresh = floor + Math.max(opt.speechMarginDb, opt.silenceMarginDb)
  const frameSec = opt.frameSec
  const totalSec = samples.length / sampleRate

  const silences: Silence[] = []
  let inSilence = env[0] < speechThresh
  let runStartFrame = 0

  for (let i = 1; i < env.length; i += 1) {
    if (inSilence && env[i] >= speechThresh) {
      silences.push({
        startSec: runStartFrame * frameSec,
        endSec: i * frameSec,
        edge: runStartFrame === 0,
      })
      inSilence = false
    } else if (!inSilence && env[i] < silenceThresh) {
      inSilence = true
      runStartFrame = i
    }
  }
  if (inSilence) {
    silences.push({ startSec: runStartFrame * frameSec, endSec: totalSec, edge: true })
  }
  return silences
}

/**
 * A head or tail silence is cut in full. An interior pause longer than `minPauseSec` is
 * shortened to `targetGapSec` by removing its *tail*, leaving a beat before the next line.
 */
export const planCuts = (silences: Silence[], options: Partial<PauseOptions> = {}): Cut[] => {
  const opt = { ...DEFAULT_PAUSE_OPTIONS, ...options }
  const cuts: Cut[] = []
  for (const s of silences) {
    const length = s.endSec - s.startSec
    if (s.edge) {
      if (length > 0) cuts.push({ startSec: s.startSec, endSec: s.endSec })
    } else if (length > opt.minPauseSec && length > opt.targetGapSec) {
      cuts.push({ startSec: s.startSec + opt.targetGapSec, endSec: s.endSec })
    }
  }
  return cuts
}

/**
 * Take seconds: every silence-to-speech transition, plus zero when the take opens on a voice.
 * Derived from the same envelope as the silences, so the two overlays never disagree.
 */
export const speechOnsets = (
  samples: Float32Array,
  sampleRate: number,
  options: Partial<PauseOptions> = {},
): number[] => {
  if (samples.length === 0) return []
  const silences = detectSilences(samples, sampleRate, options)
  const totalSec = samples.length / sampleRate

  const onsets: number[] = []
  if (!silences.some((s) => s.startSec <= 0)) onsets.push(0)
  for (const s of silences) {
    // A trailing silence never resumes, so its end is the end of the take, not an onset.
    if (s.endSec >= totalSec) continue
    onsets.push(s.endSec)
  }
  return onsets
}

export interface KeptRegion {
  inSec: number
  outSec: number
}

/**
 * The complement of the cuts over [0, durationSec]. Overlapping or unsorted cuts are merged
 * first.
 */
export const keptRegions = (durationSec: number, cuts: Cut[]): KeptRegion[] => {
  const merged: Cut[] = []
  for (const c of [...cuts].sort((a, b) => a.startSec - b.startSec)) {
    const last = merged[merged.length - 1]
    if (last && c.startSec <= last.endSec) last.endSec = Math.max(last.endSec, c.endSec)
    else merged.push({ ...c })
  }

  const kept: KeptRegion[] = []
  let cursor = 0
  for (const c of merged) {
    if (c.startSec > cursor) kept.push({ inSec: cursor, outSec: Math.min(c.startSec, durationSec) })
    cursor = Math.max(cursor, c.endSec)
  }
  if (cursor < durationSec) kept.push({ inSec: cursor, outSec: durationSec })
  return kept.filter((r) => r.outSec > r.inSec)
}
