import { clipDurationSec, speechTrack } from "./edl"
import type { Clip, Marker, Session, Take } from "./edl.types"
import type { Cut } from "./pauses"

// The derush pass, as pure edits over the EDL. Everything the review UI does — reject a
// region, accept a pause cut, turn a "bad take" flag into a cut, mute a take for
// best-of-N — lands here, so the UI holds no editing logic and undo is a snapshot of the
// value these functions return (plan: "the EDL is a plain object — snapshot it per
// operation"). Nothing touches a take's bytes; a rejected region is a clip that stops
// covering it.
//
// Everything is expressed in *take* seconds, not timeline seconds. That is what the
// waveform draws, what a flag records, and what survives every later edit — a timeline
// second means something different after each ripple.

const withSpeechClips = (session: Session, clips: Clip[]): Session => ({
  ...session,
  tracks: session.tracks.map((t) => (t.kind === "speech" ? { ...t, clips } : t)),
})

/**
 * Place every speech clip end to end in list order — the ripple. A muted clip is parked
 * at the cursor and consumes no time, so a best-of-N alternate stays in the EDL (and in
 * the take list) without pushing the programme out by its own length.
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

/** What the EDL still keeps from a take, in take seconds — the waveform's kept/removed overlay. */
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

/** Seconds of a take the EDL still plays — the take list's "kept" figure. */
export const keptDurationForTake = (session: Session, takeId: string): number =>
  clipsOfTake(session, takeId).reduce(
    (total, c) => (c.muted ? total : total + clipDurationSec(c)),
    0,
  )

/**
 * Stop covering [fromSec, toSec] of a take. A clip that the region swallows whole is
 * dropped, one it clips at an edge is shortened, one it lands inside becomes two — the
 * same split-plus-drop the pause remover emits, which is why both go through this
 * function. The timeline is re-laid afterwards, so the removed audio ripples out.
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

/** Accept a whole set of pause-cut candidates at once. Cut times are take seconds. */
export const applyCuts = (session: Session, takeId: string, cuts: Cut[]): Session =>
  cuts.reduce((s, c) => rejectTakeRange(s, takeId, c.startSec, c.endSec), session)

/**
 * The region a `retake` flag condemns. "That line was bad" is pressed the moment the line
 * ends, so the region runs back to whatever started it — the speech onset that opened the
 * line, or the previous flag if that is later (two retakes in a row must not overlap).
 * Returns null when nothing sits between: a retake pressed on the first frame condemns
 * nothing.
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

/** Every region the take's `retake` flags condemn, earliest first. */
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

/** Mute or unmute one take's clips, leaving every other take's clips exactly as they are. */
export const setTakeMuted = (session: Session, takeId: string, muted: boolean): Session =>
  relayoutSpeech(
    withSpeechClips(
      session,
      speechTrack(session).clips.map((c) =>
        c.source.kind === "take" && c.source.takeId === takeId ? { ...c, muted } : c,
      ),
    ),
  )

/**
 * Best-of-N: several takes of the same passage, one kept. Solo is the whole mechanism —
 * `muted` on a clip, no new concept — and it is reversible, because the alternates stay
 * in the EDL rather than being deleted.
 */
export const soloTake = (session: Session, takeId: string): Session =>
  relayoutSpeech(
    withSpeechClips(
      session,
      speechTrack(session).clips.map((c) =>
        c.source.kind === "take" ? { ...c, muted: c.source.takeId !== takeId } : c,
      ),
    ),
  )

export const isTakeMuted = (session: Session, takeId: string): boolean => {
  const clips = clipsOfTake(session, takeId)
  return clips.length > 0 && clips.every((c) => c.muted === true)
}

/**
 * Shuttle speeds for J and L. Tapping the same direction climbs the ladder; tapping the
 * other direction drops straight back to 1x that way, which is what a hand expects from a
 * jog wheel. K (rate 0) pauses.
 */
export const SHUTTLE_RATES = [1, 2, 4] as const

export const nextShuttleRate = (current: number, direction: 1 | -1): number => {
  if (current === 0 || Math.sign(current) !== direction) return direction
  const index = SHUTTLE_RATES.indexOf(Math.abs(current) as (typeof SHUTTLE_RATES)[number])
  if (index < 0) return direction
  return direction * SHUTTLE_RATES[Math.min(SHUTTLE_RATES.length - 1, index + 1)]
}

/** The next flag strictly after (or before) a point, for `]` and `[`. Null at the ends. */
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
 * Playback skips what the EDL removed, so review hears the programme rather than the
 * tape. Given a point in the take, the next kept second: the point itself when it is
 * inside a kept range, otherwise the start of the next one, or null past the last.
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
