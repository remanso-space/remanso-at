import { TARGET_LUFS } from "../../utils/loudness"
import type { Chapter, ChainSettings, Clip, Session, Take, Track } from "./edl.types"
import { SESSION_SAMPLE_RATE } from "./edl.types"

// Pure operations over the EDL. Every edit returns a new object and nothing here reaches for
// a clock or a random source, so the undo stack can be a plain snapshot list.

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
 * How far the spoken programme reaches. Music anchors against this and not the rendered
 * length, which would already count the outro and leave it no fixed point to sit after.
 * For the rendered length see `programmeDurationSec` in musicSlots.ts.
 */
export const speechDurationSec = (session: Session): number => {
  let end = 0
  for (const clip of speechTrack(session).clips) {
    if (clip.muted) continue
    end = Math.max(end, clipEndSec(clip))
  }
  return end
}

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

/** Clamped to the existing window, so a trim can only tighten and never expand. */
export const trimClip = (clip: Clip, inSec: number, outSec: number): Clip => {
  const nextIn = Math.max(clip.inSec, Math.min(inSec, outSec))
  const nextOut = Math.min(clip.outSec, Math.max(inSec, outSec))
  return { ...clip, inSec: nextIn, outSec: nextOut }
}

/**
 * The left half keeps the original id, so undo and selection stay stable; the right gets a
 * new one. Returns the clip unchanged, as the sole element, if the point is outside its span.
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

/** Stored in take seconds, so the mark survives every later edit. */
export const addChapter = (session: Session, chapter: Chapter): Session => ({
  ...session,
  chapters: [...session.chapters, chapter].sort((a, b) => a.atTakeSec - b.atTakeSec),
})

export const removeChapter = (session: Session, index: number): Session => ({
  ...session,
  chapters: session.chapters.filter((_, i) => i !== index),
})

/**
 * Null when the mark landed in audio a trim or pause-removal took out. This projection is why
 * flags and chapters can be stored in take seconds and survive every edit for free.
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

export const projectChapterToTimeline = (session: Session, chapter: Chapter): number | null =>
  projectTakeTimeToTimeline(session, chapter.takeId, chapter.atTakeSec)
