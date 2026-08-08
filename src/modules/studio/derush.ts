import { clipDurationSec, speechTrack } from "./edl"
import type { Clip, Marker, Session, Take } from "./edl.types"
import type { Cut } from "./pauses"

// Nothing here touches a take's bytes; a rejected region is a clip that stops covering it.
//
// Everything is expressed in *take* seconds, not timeline seconds — a timeline second means
// something different after each ripple, while take seconds survive every later edit.

const withSpeechClips = (session: Session, clips: Clip[]): Session => ({
  ...session,
  tracks: session.tracks.map((t) => (t.kind === "speech" ? { ...t, clips } : t)),
})

/**
 * Place every speech clip end to end in list order. A muted clip is parked at the cursor and
 * consumes no time, so an alternate stays in the EDL without pushing the programme out.
 */
export const relayoutSpeech = (session: Session): Session => {
  let cursor = 0
  const clips = speechTrack(session).clips.map((clip) => {
    const placed = { ...clip, atSec: cursor }
    if (!clip.muted) cursor += clipDurationSec(clip)
    return placed
  })
  return withSpeechClips(session, clips)
}

const clipsOfTake = (session: Session, takeId: string): Clip[] =>
  speechTrack(session).clips.filter((c) => c.source.kind === "take" && c.source.takeId === takeId)

/** In take seconds. */
export interface KeptClipRange {
  clipId: string
  inSec: number
  outSec: number
  muted: boolean
}

export const keptRangesForTake = (session: Session, takeId: string): KeptClipRange[] =>
  clipsOfTake(session, takeId)
    .map((c) => ({ clipId: c.id, inSec: c.inSec, outSec: c.outSec, muted: c.muted === true }))
    .sort((a, b) => a.inSec - b.inSec)

export const keptDurationForTake = (session: Session, takeId: string): number =>
  clipsOfTake(session, takeId).reduce(
    (total, c) => (c.muted ? total : total + clipDurationSec(c)),
    0,
  )

/**
 * Stop covering [fromSec, toSec] of a take. A swallowed clip is dropped, one clipped at an
 * edge is shortened, one the region lands inside becomes two. The timeline is re-laid
 * afterwards, so the removed audio ripples out.
 */
export const rejectTakeRange = (
  session: Session,
  takeId: string,
  fromSec: number,
  toSec: number,
): Session => {
  const start = Math.min(fromSec, toSec)
  const end = Math.max(fromSec, toSec)
  if (end - start <= 0) return session

  const next: Clip[] = []
  for (const clip of speechTrack(session).clips) {
    if (clip.source.kind !== "take" || clip.source.takeId !== takeId) {
      next.push(clip)
      continue
    }
    const overlapStart = Math.max(clip.inSec, start)
    const overlapEnd = Math.min(clip.outSec, end)
    if (overlapEnd <= overlapStart) {
      next.push(clip)
      continue
    }
    if (overlapStart > clip.inSec) next.push({ ...clip, outSec: overlapStart, fadeOutSec: 0 })
    if (overlapEnd < clip.outSec) {
      next.push({
        ...clip,
        id: `${clip.id}~${overlapEnd.toFixed(3)}`,
        inSec: overlapEnd,
        fadeInSec: 0,
      })
    }
  }

  return relayoutSpeech(withSpeechClips(session, next))
}

/** Cut times are take seconds. */
export const applyCuts = (session: Session, takeId: string, cuts: Cut[]): Session =>
  cuts.reduce((s, c) => rejectTakeRange(s, takeId, c.startSec, c.endSec), session)

/**
 * The region a `retake` flag condemns. The flag is pressed once the line has ended, so the
 * region runs back to the speech onset that opened it, or to the previous flag if that is
 * later — two retakes in a row must not overlap. Null when nothing sits between.
 */
export const retakeRange = (
  take: Take,
  marker: Marker,
  onsets: number[],
): { inSec: number; outSec: number } | null => {
  if (marker.kind !== "retake") return null
  const at = marker.atTakeSec
  let start = 0
  for (const onset of onsets) if (onset < at && onset > start) start = onset
  for (const flag of take.flags)
    if (flag.atTakeSec < at && flag.atTakeSec > start) {
      start = flag.atTakeSec
    }
  if (at - start <= 0) return null
  return { inSec: start, outSec: at }
}

export const retakeRanges = (take: Take, onsets: number[]): { inSec: number; outSec: number }[] =>
  take.flags
    .filter((f) => f.kind === "retake")
    .map((f) => retakeRange(take, f, onsets))
    .filter((r): r is { inSec: number; outSec: number } => r !== null)
    .sort((a, b) => a.inSec - b.inSec)

export const setClipMuted = (session: Session, clipId: string, muted: boolean): Session =>
  relayoutSpeech(
    withSpeechClips(
      session,
      speechTrack(session).clips.map((c) => (c.id === clipId ? { ...c, muted } : c)),
    ),
  )

export const setTakeMuted = (session: Session, takeId: string, muted: boolean): Session =>
  relayoutSpeech(
    withSpeechClips(
      session,
      speechTrack(session).clips.map((c) =>
        c.source.kind === "take" && c.source.takeId === takeId ? { ...c, muted } : c,
      ),
    ),
  )

/** Reversible: the alternates stay in the EDL muted rather than being deleted. */
export const soloTake = (session: Session, takeId: string): Session =>
  relayoutSpeech(
    withSpeechClips(
      session,
      speechTrack(session).clips.map((c) =>
        c.source.kind === "take" ? { ...c, muted: c.source.takeId !== takeId } : c,
      ),
    ),
  )

/**
 * Destructive, unlike a mute: the caller also frees the take's bytes and analysis, so this
 * belongs on a fresh history baseline rather than the undo stack.
 */
export const removeTake = (session: Session, takeId: string): Session => {
  const clips = speechTrack(session).clips.filter(
    (c) => !(c.source.kind === "take" && c.source.takeId === takeId),
  )
  const chapters = session.chapters.filter((c) => c.takeId !== takeId)
  const takes = session.takes.filter((t) => t.id !== takeId)
  return relayoutSpeech(withSpeechClips({ ...session, chapters, takes }, clips))
}

export const isTakeMuted = (session: Session, takeId: string): boolean => {
  const clips = clipsOfTake(session, takeId)
  return clips.length > 0 && clips.every((c) => c.muted === true)
}

/**
 * Shuttle speeds for J and L. Tapping the same direction climbs the ladder; tapping the other
 * direction drops straight back to 1x that way. K (rate 0) pauses.
 */
export const SHUTTLE_RATES = [1, 2, 4] as const

export const nextShuttleRate = (current: number, direction: 1 | -1): number => {
  if (current === 0 || Math.sign(current) !== direction) return direction
  const index = SHUTTLE_RATES.indexOf(Math.abs(current) as (typeof SHUTTLE_RATES)[number])
  if (index < 0) return direction
  return direction * SHUTTLE_RATES[Math.min(SHUTTLE_RATES.length - 1, index + 1)]
}

/** Strictly after; null at the end. */
export const flagAfter = (flags: Marker[], sec: number): Marker | null => {
  let best: Marker | null = null
  for (const f of flags) {
    if (f.atTakeSec <= sec) continue
    if (!best || f.atTakeSec < best.atTakeSec) best = f
  }
  return best
}

export const flagBefore = (flags: Marker[], sec: number): Marker | null => {
  let best: Marker | null = null
  for (const f of flags) {
    if (f.atTakeSec >= sec) continue
    if (!best || f.atTakeSec > best.atTakeSec) best = f
  }
  return best
}

/**
 * The point itself when it is inside a kept range, otherwise the start of the next one, or
 * null past the last — playback skips what the EDL removed.
 */
export const nextKeptSec = (kept: KeptClipRange[], sec: number): number | null => {
  let next: number | null = null
  for (const range of kept) {
    if (range.muted) continue
    if (sec >= range.inSec && sec < range.outSec) return sec
    if (range.inSec > sec && (next === null || range.inSec < next)) next = range.inSec
  }
  return next
}
