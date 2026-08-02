// The cue snap index (slice 6). A cue is placed at a timeline second, and the moments worth
// snapping to are already known from the derush analysis: the boundaries of the speech
// clips, every flag, every speech onset, and every chapter mark. Snapping a sting to a
// speech onset is the whole game — it lands the sound ON the first word instead of 80 ms
// before it, which is the difference between a cue and a mistake.
//
// Every target is projected into timeline seconds, because that is the axis a cue clip's
// atSec lives on. Flags, onsets and chapters are stored in take seconds and pass through
// the EDL's take-time projection, so they move with every edit and a snap point never
// drifts off the audio it marked. Pause-cut boundaries need no special case: an accepted
// pause cut is a clip boundary, and clip boundaries are already in the index.
//
// Pure and cheap — recompute it whenever the EDL changes.

import type { TakeAnalysis } from "./analyzeTake"
import { clipEndSec, projectTakeTimeToTimeline, speechTrack } from "./edl"
import type { Session } from "./edl.types"

export type SnapKind = "clip" | "flag" | "onset" | "chapter"

export interface SnapPoint {
  atSec: number
  kind: SnapKind
}

const EPSILON = 1e-3

/**
 * Every snap target on the timeline, sorted and de-duplicated. `analyses` supplies each
 * take's speech onsets (the same object the review pass already holds); a take with no
 * analysis simply contributes no onsets.
 */
export const snapPoints = (
  session: Session,
  analyses: Record<string, Pick<TakeAnalysis, "onsets">>,
): SnapPoint[] => {
  const points: SnapPoint[] = []
  const push = (atSec: number | null, kind: SnapKind) => {
    if (atSec !== null && atSec >= 0) points.push({ atSec, kind })
  }

  const speech = speechTrack(session)

  // Clip boundaries (which include every accepted pause cut's seam).
  for (const clip of speech.clips) {
    if (clip.muted) continue
    push(clip.atSec, "clip")
    push(clipEndSec(clip), "clip")
  }

  // Flags and speech onsets, projected from take seconds.
  for (const take of session.takes) {
    for (const flag of take.flags) {
      push(projectTakeTimeToTimeline(session, take.id, flag.atTakeSec), "flag")
    }
    for (const onset of analyses[take.id]?.onsets ?? []) {
      push(projectTakeTimeToTimeline(session, take.id, onset), "onset")
    }
  }

  // Chapters.
  for (const chapter of session.chapters) {
    push(projectTakeTimeToTimeline(session, chapter.takeId, chapter.atTakeSec), "chapter")
  }

  points.sort((a, b) => a.atSec - b.atSec)

  // De-duplicate coincident points, keeping the first (clip boundaries sort stably ahead of
  // the others at the same instant only by insertion; a tie is harmless either way).
  const unique: SnapPoint[] = []
  for (const p of points) {
    const last = unique[unique.length - 1]
    if (!last || p.atSec - last.atSec > EPSILON) unique.push(p)
  }
  return unique
}

/**
 * Snap `atSec` to the nearest target within `toleranceSec`, or return it unchanged when
 * nothing is close (or the caller held the free-place modifier and passed no points). The
 * points must be sorted — `snapPoints` returns them that way.
 */
export const snapToNearest = (
  atSec: number,
  points: SnapPoint[],
  toleranceSec: number,
): { atSec: number; snapped: SnapPoint | null } => {
  let best: SnapPoint | null = null
  let bestDist = toleranceSec
  for (const p of points) {
    const dist = Math.abs(p.atSec - atSec)
    if (dist <= bestDist) {
      best = p
      bestDist = dist
    } else if (p.atSec > atSec) {
      break // sorted: once we pass atSec and stop improving, nothing further is closer
    }
  }
  return best ? { atSec: best.atSec, snapped: best } : { atSec, snapped: null }
}
