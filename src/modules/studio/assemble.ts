import { dbToAmplitude } from "../../utils/loudness"
import { duckEnvelope } from "./duck"
import { clipDurationSec, speechTrack } from "./edl"
import type { Session } from "./edl.types"
import { applySpeechBreaks, cueClipsFromSlots, hasMusic, programmeDurationSec } from "./musicSlots"
import { createLimiter, renderProgramme, type RenderResult } from "./renderChain"

// Stage order is not negotiable: the expander and compressor must see speech only. Run over
// music, the expander reads the music as signal and stops gating room tone, and the compressor
// pumps it against every syllable. So the chain never touches a cue — cues arrive already
// mixed and are added to the finished voice.

/** Decoded mono samples per take id, at the session sample rate. */
export type TakePcm = Record<string, Float32Array>

/** Decoded mono samples per music track, keyed by its OPFS path. */
export type CuePcm = Record<string, Float32Array>

const equalPowerIn = (t: number) => Math.sin((t * Math.PI) / 2)
const equalPowerOut = (t: number) => Math.cos((t * Math.PI) / 2)

/** Shared by the speech and cue passes, so fades and bounds behave identically on both. */
const mixClipInto = (
  out: Float32Array,
  src: Float32Array,
  srcStart: number,
  atSample: number,
  count: number,
  gain: number,
  fadeInSec: number,
  fadeOutSec: number,
  sampleRate: number,
  duck: Float32Array | null,
): void => {
  const fadeIn = Math.round(fadeInSec * sampleRate)
  const fadeOut = Math.round(fadeOutSec * sampleRate)

  for (let i = 0; i < count; i += 1) {
    const from = srcStart + i
    const to = atSample + i
    if (from < 0 || from >= src.length || to < 0 || to >= out.length) continue

    let env = 1
    if (fadeIn > 0 && i < fadeIn) env *= equalPowerIn((i + 0.5) / fadeIn)
    if (fadeOut > 0 && i >= count - fadeOut)
      env *= equalPowerOut((i - (count - fadeOut) + 0.5) / fadeOut)

    const d = duck ? duck[to] : 1
    out[to] += src[from] * gain * env * d
  }
}

/**
 * Clips are summed rather than overwritten, so an intentional overlap (a crossfade at a pause
 * cut) mixes instead of clobbering.
 */
export const assembleSpeech = (
  session: Session,
  takePcm: TakePcm,
  sampleRate: number,
): Float32Array => {
  const out = new Float32Array(Math.round(programmeDurationSec(session) * sampleRate))
  const track = speechTrack(session)

  for (const clip of track.clips) {
    if (clip.muted) continue
    if (clip.source.kind !== "take") continue
    const src = takePcm[clip.source.takeId]
    if (!src) continue

    const gain = dbToAmplitude(clip.gainDb + track.gainDb)
    mixClipInto(
      out,
      src,
      Math.round(clip.inSec * sampleRate),
      Math.round(clip.atSec * sampleRate),
      Math.round(clipDurationSec(clip) * sampleRate),
      gain,
      clip.fadeInSec,
      clip.fadeOutSec,
      sampleRate,
      null,
    )
  }

  return out
}

/**
 * A clip with `duck: "under-speech"` is multiplied by `duckEnv` at its timeline position.
 * Per-clip equal-power fades are what makes a looped slot's seams inaudible: the projection
 * hands over overlapping clips whose fades cross.
 */
export const assembleCues = (
  session: Session,
  cuePcm: CuePcm,
  duckEnv: Float32Array | null,
  sampleRate: number,
): Float32Array => {
  const out = new Float32Array(Math.round(programmeDurationSec(session) * sampleRate))

  for (const clip of cueClipsFromSlots(session)) {
    if (clip.source.kind !== "music") continue

    const count = Math.round(clipDurationSec(clip) * sampleRate)
    if (count <= 0) continue

    const src = cuePcm[clip.source.opfsPath]
    if (!src) continue

    const gain = dbToAmplitude(clip.gainDb)
    const duck = clip.duck === "under-speech" ? duckEnv : null
    mixClipInto(
      out,
      src,
      Math.round(clip.inSec * sampleRate),
      Math.round(clip.atSec * sampleRate),
      count,
      gain,
      clip.fadeInSec,
      clip.fadeOutSec,
      sampleRate,
      duck,
    )
  }

  return out
}

export interface SessionRender extends RenderResult {
  durationSec: number
}

/** Length-preserving: the limiter's lookahead delay is read back out of the flushed tail. */
const brickLimit = (buf: Float32Array, ceilingDb: number, sampleRate: number): Float32Array => {
  const limiter = createLimiter(ceilingDb, sampleRate)
  const limited = limiter.process(buf)
  const tail = limiter.flush()
  const out = new Float32Array(buf.length)
  const at = (i: number) => (i < limited.length ? limited[i] : tail[i - limited.length])
  for (let i = 0; i < buf.length; i += 1) out[i] = at(i + limiter.lookahead)
  return out
}

/** A session with no music renders as speech alone, chain output untouched. */
export const renderSession = (
  session: Session,
  takePcm: TakePcm,
  sampleRate: number,
  cuePcm: CuePcm = {},
): SessionRender => {
  // Open any real-break silences first, so the cues land in the gaps the speech leaves.
  const eff = applySpeechBreaks(session)
  const speech = assembleSpeech(eff, takePcm, sampleRate)
  const rendered = renderProgramme(speech, sampleRate, session.chain)
  const durationSec = speech.length / sampleRate

  if (!hasMusic(eff)) {
    return { ...rendered, durationSec }
  }

  const duckEnv = duckEnvelope(speech, sampleRate)
  const cues = assembleCues(eff, cuePcm, duckEnv, sampleRate)

  const mixed = new Float32Array(rendered.samples.length)
  for (let i = 0; i < mixed.length; i += 1) {
    mixed[i] = rendered.samples[i] + (i < cues.length ? cues[i] : 0)
  }
  const samples = brickLimit(mixed, session.chain.limiterCeilingDb, sampleRate)

  return {
    samples,
    measuredLufs: rendered.measuredLufs,
    appliedGainDb: rendered.appliedGainDb,
    durationSec,
  }
}
