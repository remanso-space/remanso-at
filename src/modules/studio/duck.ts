// Ducking a cue under speech (slice 6). A bed or a music clip marked `duck: "under-speech"`
// is pulled down whenever the voice is talking and allowed back up in the gaps. The key
// that drives it is the *offline* speech envelope — the same silence detection pauses.ts
// already runs — not a realtime sidechain. Offline is strictly better here: the reduction
// can be in place before the word starts (no attack overshoot on the first syllable), the
// result is deterministic, and the analysis has already been paid for.
//
// The output is a per-sample gain multiplier over the whole timeline. A cue clip multiplies
// its own samples by the slice of this envelope under it, so two cues ducking against the
// same voice duck identically.

import { dbToAmplitude } from "../../utils/loudness"
import { detectSilences, type PauseOptions } from "./pauses"

export interface DuckOptions {
  /** How fast the duck engages when a line starts. Fast, so the bed is already down. */
  attackSec: number
  /** How slowly it lets go after a line ends. Slow, so the bed swells back naturally. */
  releaseSec: number
  /** How far the cue is pulled down while speech is present. */
  depthDb: number
}

export const DEFAULT_DUCK: DuckOptions = {
  attackSec: 0.3,
  releaseSec: 0.8,
  depthDb: -12,
}

/**
 * A per-sample gain multiplier in (0, 1] over `speech`'s timeline: unity in the pauses,
 * `depthDb` of reduction under speech, ramped in at the attack rate and out at the release
 * rate. `speech` is the assembled speech timeline (already aligned to the cue timeline);
 * presence is the complement of `detectSilences`, so the duck opens exactly where a line
 * ends.
 */
export const duckEnvelope = (
  speech: Float32Array,
  sampleRate: number,
  options: Partial<DuckOptions & PauseOptions> = {},
): Float32Array => {
  const opt = { ...DEFAULT_DUCK, ...options }
  const env = new Float32Array(speech.length)
  if (speech.length === 0) return env

  // Presence: 1 where the voice is talking, 0 inside a detected silence. Built from the
  // same detector the review pass uses, so the duck and the pause cuts never disagree.
  const silences = detectSilences(speech, sampleRate, options)
  const present = new Float32Array(speech.length).fill(1)
  for (const s of silences) {
    const from = Math.max(0, Math.floor(s.startSec * sampleRate))
    const to = Math.min(speech.length, Math.ceil(s.endSec * sampleRate))
    for (let i = from; i < to; i += 1) present[i] = 0
  }

  const attackCoeff = Math.exp(-1 / (Math.max(1e-4, opt.attackSec) * sampleRate))
  const releaseCoeff = Math.exp(-1 / (Math.max(1e-4, opt.releaseSec) * sampleRate))
  const floor = dbToAmplitude(opt.depthDb)

  // `key` follows presence: rising toward 1 at the attack rate (duck engaging), falling
  // toward 0 at the release rate (duck letting go). The gain is depthDb scaled by the key.
  let key = present[0]
  for (let i = 0; i < speech.length; i += 1) {
    const target = present[i]
    const coeff = target > key ? attackCoeff : releaseCoeff
    key = target + (key - target) * coeff
    // key 0 → unity (1), key 1 → floor (depthDb). Interpolate in the amplitude domain.
    env[i] = 1 + (floor - 1) * key
  }
  return env
}
