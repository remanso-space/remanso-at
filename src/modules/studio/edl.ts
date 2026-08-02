import { TARGET_LUFS } from "../../utils/loudness"
import type { Chapter, ChainSettings, Clip, Session, Take, Track } from "./edl.types"
import { SESSION_SAMPLE_RATE } from "./edl.types"

// Pure operations over the EDL. Every edit returns a new object; nothing mutates a
// take's bytes and nothing here reaches for a clock or a random source, so the whole
// module is deterministic and the derush undo stack (slice 5) is just a snapshot list.

/**
 * The "podcast voice" chain (plan: post-production set, ranked). HPF 80 + presence
 * shelf, a downward expander that does not pump, a gentle compressor, loudness to the
 * BS.1770 target, and a brick-wall limiter at -1 dBFS as a clip guard.
 */
export const DEFAULT_CHAIN: ChainSettings = {
  hpfHz: 80,
  presenceDb: 3,
  expanderThresholdDb: -45,
  compressorThresholdDb: -18,
  targetLufs: TARGET_LUFS,
  limiterCeilingDb: -1,
}

export const newSession = (id: string, title: string): Session => ({
  id,
  title,
  sampleRate: SESSION_SAMPLE_RATE,
  takes: [],
  tracks: [{ id: "speech", kind: "speech", clips: [], gainDb: 0 }],
  chapters: [],
  musicSlots: [],
  chain: { ...DEFAULT_CHAIN },
})

export const speechTrack = (session: Session): Track =>
  session.tracks.find((t) => t.kind === "speech")!

export const clipDurationSec = (clip: Clip): number => clip.outSec - clip.inSec

export const clipEndSec = (clip: Clip): number => clip.atSec + clipDurationSec(clip)

/**
 * How far the spoken programme reaches. Music is anchored against this rather than against
 * the rendered length: an outro sits after the last word, and a length that already counted
 * the outro would have no fixed point to sit after. The rendered length — speech plus
 * whatever music runs past it — is `programmeDurationSec` in musicSlots.ts.
 */
export const speechDurationSec = (session: Session): number => {
  let end = 0
  for (const clip of speechTrack(session).clips) {
    if (clip.muted) continue
    end = Math.max(end, clipEndSec(clip))
  }
  return end
}

/**
 * Append a take and drop a full-length speech clip for it at the end of the speech
 * track — the default one-take slice-4 layout, before any trim or pause-removal.
 */
export const addTake = (session: Session, take: Take, clipId: string): Session => {
  const atSec = speechDurationSec(session)
  const clip: Clip = {
    id: clipId,
    source: { kind: "take", takeId: take.id },
    inSec: 0,
    outSec: take.durationSec,
    atSec,
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
    duck: "none",
  }
  return {
    ...session,
    takes: [...session.takes, take],
    tracks: session.tracks.map((t) =>
      t.kind === "speech" ? { ...t, clips: [...t.clips, clip] } : t,
    ),
  }
}

/**
 * Trim a clip to a new window into its source. Clamped to the existing window so a
 * trim can only tighten, never expand past what was already there.
 */
export const trimClip = (clip: Clip, inSec: number, outSec: number): Clip => {
  const nextIn = Math.max(clip.inSec, Math.min(inSec, outSec))
  const nextOut = Math.min(clip.outSec, Math.max(inSec, outSec))
  return { ...clip, inSec: nextIn, outSec: nextOut }
}

/**
 * Split a clip at a point on the timeline into two clips that share the source. The
 * left keeps the original id (so undo/selection stays stable); the right gets a new id.
 * Returns the clip unchanged (as the sole element) if the point is outside its span.
 */
export const splitClipAt = (
  clip: Clip,
  atTimelineSec: number,
  newRightId: string,
): [Clip] | [Clip, Clip] => {
  if (atTimelineSec <= clip.atSec || atTimelineSec >= clipEndSec(clip)) return [clip]
  const offsetIntoSource = atTimelineSec - clip.atSec
  const cutSourceSec = clip.inSec + offsetIntoSource
  const left: Clip = { ...clip, outSec: cutSourceSec, fadeOutSec: 0 }
  const right: Clip = {
    ...clip,
    id: newRightId,
    inSec: cutSourceSec,
    atSec: atTimelineSec,
    fadeInSec: 0,
  }
  return [left, right]
}

// —— Chapters (slice 6): a marker dropped against a take, projected at render ——

/** Drop a chapter marker at a take-relative time. Stored in take seconds — survives edits. */
export const addChapter = (session: Session, chapter: Chapter): Session => ({
  ...session,
  chapters: [...session.chapters, chapter].sort((a, b) => a.atTakeSec - b.atTakeSec),
})

/** Remove the chapter at `index` (its position in `session.chapters`). */
export const removeChapter = (session: Session, index: number): Session => ({
  ...session,
  chapters: session.chapters.filter((_, i) => i !== index),
})

/**
 * Project a take-relative time onto the rendered timeline. Walks the speech clips cut from
 * that take and finds the one whose source window contains the mark; returns null when the
 * mark landed in audio a trim or pause-removal took out. This is why flags and chapters are
 * stored in take seconds and never timeline seconds — they survive every edit for free, and
 * the cue snap index projects them here.
 */
export const projectTakeTimeToTimeline = (
  session: Session,
  takeId: string,
  atTakeSec: number,
): number | null => {
  for (const clip of speechTrack(session).clips) {
    if (clip.source.kind !== "take" || clip.source.takeId !== takeId) continue
    if (atTakeSec >= clip.inSec && atTakeSec < clip.outSec) {
      return clip.atSec + (atTakeSec - clip.inSec)
    }
  }
  return null
}

/** Project a chapter's mark onto the timeline (a take-time projection by any other name). */
export const projectChapterToTimeline = (session: Session, chapter: Chapter): number | null =>
  projectTakeTimeToTimeline(session, chapter.takeId, chapter.atTakeSec)
