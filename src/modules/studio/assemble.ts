import { dbToAmplitude } from "../../utils/loudness"
import { clipDurationSec, speechTrack, timelineDurationSec } from "./edl"
import type { Session } from "./edl.types"
import { renderProgramme, type RenderResult } from "./renderChain"

// The bridge from the EDL to the renderer: lay every speech clip onto a timeline PCM
// buffer, honouring trims (inSec/outSec into the source), placement (atSec), clip gain and
// equal-power fades. Pure — the decoded take samples come in as a map, so this is unit-
// testable without a decoder. renderSession then runs the chain over the assembled speech.
//
// Slice 4 only has take-sourced speech clips; file and bed sources arrive with the cue
// track in slice 6 and are skipped here for now.

/** Decoded mono samples per take id, at the session sample rate. */
export type TakePcm = Record<string, Float32Array>

const equalPowerIn = (t: number) => Math.sin((t * Math.PI) / 2)
const equalPowerOut = (t: number) => Math.cos((t * Math.PI) / 2)

/**
 * Sum every non-muted speech clip onto one mono timeline buffer. Clips are summed rather
 * than overwritten so an intentional overlap (a crossfade at a pause cut) mixes instead of
 * clobbering.
 */
export const assembleSpeech = (
  session: Session,
  takePcm: TakePcm,
  sampleRate: number,
): Float32Array => {
  const out = new Float32Array(Math.round(timelineDurationSec(session) * sampleRate))
  const track = speechTrack(session)

  for (const clip of track.clips) {
    if (clip.muted) continue
    if (clip.source.kind !== "take") continue
    const src = takePcm[clip.source.takeId]
    if (!src) continue

    const gain = dbToAmplitude(clip.gainDb + track.gainDb)
    const startSample = Math.round(clip.inSec * sampleRate)
    const atSample = Math.round(clip.atSec * sampleRate)
    const count = Math.round(clipDurationSec(clip) * sampleRate)
    const fadeIn = Math.round(clip.fadeInSec * sampleRate)
    const fadeOut = Math.round(clip.fadeOutSec * sampleRate)

    for (let i = 0; i < count; i += 1) {
      const from = startSample + i
      const to = atSample + i
      if (from < 0 || from >= src.length || to < 0 || to >= out.length) continue

      let env = 1
      if (fadeIn > 0 && i < fadeIn) env *= equalPowerIn((i + 0.5) / fadeIn)
      if (fadeOut > 0 && i >= count - fadeOut)
        env *= equalPowerOut((i - (count - fadeOut) + 0.5) / fadeOut)

      out[to] += src[from] * gain * env
    }
  }

  return out
}

export interface SessionRender extends RenderResult {
  durationSec: number
}

/** Assemble the speech timeline, then run the chain — normalise to target, limit to ceiling. */
export const renderSession = (
  session: Session,
  takePcm: TakePcm,
  sampleRate: number,
): SessionRender => {
  const speech = assembleSpeech(session, takePcm, sampleRate)
  const rendered = renderProgramme(speech, sampleRate, session.chain)
  return { ...rendered, durationSec: speech.length / sampleRate }
}
