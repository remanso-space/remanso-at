// Every target is projected into timeline seconds, because that is the axis a cue clip's
// `atSec` lives on. Flags, onsets and chapters are stored in take seconds and pass through the
// EDL's take-time projection, so a snap point never drifts off the audio it marked.
//
// Pause-cut boundaries need no special case: an accepted pause cut is a clip boundary, and
// clip boundaries are already in the index.

import type { TakeAnalysis } from "./analyzeTake"
import { clipEndSec, projectTakeTimeToTimeline, speechTrack } from "./edl"
import type { Session } from "./edl.types"

export type SnapKind = "clip" | "flag" | "onset" | "chapter"

export interface SnapPoint {
  atSec: number
  kind: SnapKind
}

const EPSILON = 1e-3

/** Sorted and de-duplicated. A take with no entry in `analyses` contributes no onsets. */
export const snapPoints = (
  session: Session,
  analyses: Record<string, Pick<TakeAnalysis, "onsets">>,
): SnapPoint[] => {
  const points: SnapPoint[] = []
  const push = (atSec: number | null, kind: SnapKind) => {
    if (atSec !== null && atSec >= 0) points.push({ atSec, kind })
  }

  const speech = speechTrack(session)

  for (const clip of speech.clips) {
    if (clip.muted) continue
    push(clip.atSec, "clip")
    push(clipEndSec(clip), "clip")
  }

  for (const take of session.takes) {
    for (const flag of take.flags) {
      push(projectTakeTimeToTimeline(session, take.id, flag.atTakeSec), "flag")
    }
    for (const onset of analyses[take.id]?.onsets ?? []) {
      push(projectTakeTimeToTimeline(session, take.id, onset), "onset")
    }
  }

  for (const chapter of session.chapters) {
    push(projectTakeTimeToTimeline(session, chapter.takeId, chapter.atTakeSec), "chapter")
  }

  points.sort((a, b) => a.atSec - b.atSec)

  // De-duplicate coincident points, keeping the first. Ties break by insertion order, which
  // is harmless either way.
  const unique: SnapPoint[] = []
  for (const p of points) {
    const last = unique[unique.length - 1]
    if (!last || p.atSec - last.atSec > EPSILON) unique.push(p)
  }
  return unique
}

/** `points` must be sorted — `snapPoints` returns them that way. */
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
