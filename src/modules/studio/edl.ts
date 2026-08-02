import { TARGET_LUFS } from "../../utils/loudness"
import type { BedId, Chapter, ChainSettings, Clip, Session, Take, Track } from "./edl.types"
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
  tracks: [
    { id: "speech", kind: "speech", clips: [], gainDb: 0 },
    { id: "cue", kind: "cue", clips: [], gainDb: 0 },
  ],
  chapters: [],
  chain: { ...DEFAULT_CHAIN },
})

export const speechTrack = (session: Session): Track =>
  session.tracks.find((t) => t.kind === "speech")!

/** The cue track. Undefined only on a malformed session — newSession always makes both. */
export const cueTrack = (session: Session): Track | undefined =>
  session.tracks.find((t) => t.kind === "cue")

/** Whether the cue track carries any non-muted clip — drives the two-stage render and bitrate. */
export const hasCueClips = (session: Session): boolean => {
  const track = cueTrack(session)
  return !!track && track.clips.some((c) => !c.muted)
}

export const clipDurationSec = (clip: Clip): number => clip.outSec - clip.inSec

export const clipEndSec = (clip: Clip): number => clip.atSec + clipDurationSec(clip)

/** The rendered length: the furthest any non-muted clip reaches on the timeline. */
export const timelineDurationSec = (session: Session): number => {
  let end = 0
  for (const track of session.tracks) {
    for (const clip of track.clips) {
      if (clip.muted) continue
      end = Math.max(end, clipEndSec(clip))
    }
  }
  return end
}

/**
 * Append a take and drop a full-length speech clip for it at the end of the speech
 * track — the default one-take slice-4 layout, before any trim or pause-removal.
 */
export const addTake = (session: Session, take: Take, clipId: string): Session => {
  const atSec = timelineDurationSec(session)
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

// —— The cue track (slice 6): music, sounds, procedural ambient ——

/** A bed's default gain: 14 dB down, so it sits under the -16 LUFS speech programme. */
export const DEFAULT_BED_GAIN_DB = -14

/**
 * Fades that suit a clip's length. A long bed opens and closes slowly (2 s in, 4 s out);
 * a short sting keeps ~30 ms so a 2 s fade does not swallow a half-second sound. Neither
 * fade may exceed half the clip.
 */
export const defaultFades = (durationSec: number): { fadeInSec: number; fadeOutSec: number } => {
  const half = durationSec / 2
  if (durationSec < 5) {
    const f = Math.min(0.03, half)
    return { fadeInSec: f, fadeOutSec: f }
  }
  return { fadeInSec: Math.min(2, half), fadeOutSec: Math.min(4, half) }
}

const withCueClip = (session: Session, clip: Clip): Session => ({
  ...session,
  tracks: session.tracks.map((t) => (t.kind === "cue" ? { ...t, clips: [...t.clips, clip] } : t)),
})

/**
 * Place a procedural bed on the cue track at `atSec` for `lengthSec`. Ducks under speech
 * by default and opens/closes on long fades — a bed is the floor a scene sits on, not an
 * event. `inSec` indexes into the bed's infinite stream, so a seed fixes the exact audio.
 */
export const addBedClip = (
  session: Session,
  params: { bedId: BedId; seed: number; atSec: number; lengthSec: number },
  clipId: string,
): Session => {
  const fades = defaultFades(params.lengthSec)
  return withCueClip(session, {
    id: clipId,
    source: { kind: "bed", bedId: params.bedId, seed: params.seed },
    inSec: 0,
    outSec: params.lengthSec,
    atSec: params.atSec,
    gainDb: DEFAULT_BED_GAIN_DB,
    fadeInSec: fades.fadeInSec,
    fadeOutSec: fades.fadeOutSec,
    duck: "under-speech",
  })
}

/**
 * Place an imported music/sound file on the cue track at `atSec`. Fades default to the
 * clip's length; ducking is off (a placed sting lands in a gap) and opted into per clip.
 */
export const addCueFileClip = (
  session: Session,
  params: { opfsPath: string; atSec: number; durationSec: number },
  clipId: string,
): Session => {
  const fades = defaultFades(params.durationSec)
  return withCueClip(session, {
    id: clipId,
    source: { kind: "file", opfsPath: params.opfsPath },
    inSec: 0,
    outSec: params.durationSec,
    atSec: params.atSec,
    gainDb: 0,
    fadeInSec: fades.fadeInSec,
    fadeOutSec: fades.fadeOutSec,
    duck: "none",
  })
}

/**
 * Lay a low room-tone bed under the whole programme, from the same engine. Below -55 dBFS
 * it is inaudible under speech and noticed only where it fills a pause cut's dead-silent
 * seam — which is the point. Added once, spanning the current timeline; not ducked, since
 * a room tone that ducks itself away in the gaps defeats its own purpose.
 */
export const addRoomToneFill = (session: Session, seed: number, clipId: string): Session => {
  const lengthSec = timelineDurationSec(session)
  if (lengthSec <= 0) return session
  return withCueClip(session, {
    id: clipId,
    source: { kind: "bed", bedId: "roomTone", seed },
    inSec: 0,
    outSec: lengthSec,
    atSec: 0,
    gainDb: 0,
    fadeInSec: 0.1,
    fadeOutSec: 0.1,
    duck: "none",
  })
}

const mapCueClips = (session: Session, fn: (clip: Clip) => Clip): Session => ({
  ...session,
  tracks: session.tracks.map((t) => (t.kind === "cue" ? { ...t, clips: t.clips.map(fn) } : t)),
})

/** Mute or unmute a single cue clip (best-of-N on the cue track, or silencing a bed). */
export const setCueClipMuted = (session: Session, clipId: string, muted: boolean): Session =>
  mapCueClips(session, (c) => (c.id === clipId ? { ...c, muted } : c))

/** Toggle whether a cue ducks under speech. A sting in a gap wants `none`; a bed wants it on. */
export const setCueClipDuck = (
  session: Session,
  clipId: string,
  duck: "none" | "under-speech",
): Session => mapCueClips(session, (c) => (c.id === clipId ? { ...c, duck } : c))

/** Set a cue clip's gain in dB. */
export const setCueClipGainDb = (session: Session, clipId: string, gainDb: number): Session =>
  mapCueClips(session, (c) => (c.id === clipId ? { ...c, gainDb } : c))

/** Remove a cue clip from the cue track. */
export const removeCueClip = (session: Session, clipId: string): Session => ({
  ...session,
  tracks: session.tracks.map((t) =>
    t.kind === "cue" ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t,
  ),
})

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
