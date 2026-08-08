import {
  clipEndSec,
  projectChapterToTimeline,
  speechDurationSec,
  speechTrack,
  splitClipAt,
} from "./edl"
import type { Clip, MusicPick, MusicSlot, Session, SlotAnchor, SlotKind } from "./edl.types"

// Cue clips are derived from the slots on every read, never stored beside them: a slot's
// length lives in one place, so editing it cannot leave a stale clip behind.

/** The crossfade at a loop seam. Long enough to hide the join, short enough not to smear. */
const LOOP_CROSSFADE_SEC = 0.5

const SLOT_FADE_SEC = 1

/** Runaway guard: a slot cannot emit more segments than this, whatever the arithmetic says. */
const MAX_SEGMENTS = 256

interface SlotDefaults {
  anchor: SlotAnchor
  lengthSec: number
  gainDb: number
  duck: boolean
}

/**
 * An intro opens over the first words, so it is loud and unducked; a break lands under speech
 * that keeps going, so it is quiet and ducked; an outro plays out after the last word.
 */
export const SLOT_DEFAULTS: Record<SlotKind, SlotDefaults> = {
  intro: { anchor: { kind: "absolute", atSec: 0 }, lengthSec: 8, gainDb: -6, duck: false },
  break: { anchor: { kind: "chapter", chapterIndex: 0 }, lengthSec: 4, gainDb: -12, duck: true },
  outro: { anchor: { kind: "speech-end" }, lengthSec: 10, gainDb: -6, duck: false },
}

export const newSlot = (kind: SlotKind, id: string): MusicSlot => ({
  id,
  kind,
  ...SLOT_DEFAULTS[kind],
  inSec: 0,
  pick: null,
})

export const addSlot = (session: Session, slot: MusicSlot): Session => ({
  ...session,
  musicSlots: [...session.musicSlots, slot],
})

export const removeSlot = (session: Session, slotId: string): Session => ({
  ...session,
  musicSlots: session.musicSlots.filter((s) => s.id !== slotId),
})

export const updateSlot = (
  session: Session,
  slotId: string,
  patch: Partial<Omit<MusicSlot, "id" | "kind">>,
): Session => ({
  ...session,
  musicSlots: session.musicSlots.map((s) => (s.id === slotId ? { ...s, ...patch } : s)),
})

export const fillSlot = (session: Session, slotId: string, pick: MusicPick): Session =>
  updateSlot(session, slotId, { pick, inSec: 0 })

/**
 * Where a slot lands, or null when a trim removed the chapter it anchors to — the slot then
 * does not render, rather than silently sliding the music somewhere else.
 */
export const resolveAnchorSec = (session: Session, slot: MusicSlot): number | null => {
  switch (slot.anchor.kind) {
    case "absolute":
      return Math.max(0, slot.anchor.atSec)
    case "speech-end":
      return speechDurationSec(session)
    case "chapter": {
      const chapter = session.chapters[slot.anchor.chapterIndex]
      if (!chapter) return null
      return projectChapterToTimeline(session, chapter)
    }
  }
}

const playable = (session: Session, slot: MusicSlot): boolean =>
  !!slot.pick && slot.lengthSec > 0 && resolveAnchorSec(session, slot) !== null

/**
 * A track shorter than two crossfades cannot be looped without chewing its own fades, so it
 * plays once and the slot ends early rather than stuttering.
 */
export const clipsForSlot = (session: Session, slot: MusicSlot): Clip[] => {
  if (!playable(session, slot)) return []
  const pick = slot.pick!
  const atSec = resolveAnchorSec(session, slot)!

  const available = Math.max(0, pick.sourceDurationSec - slot.inSec)
  if (available <= 0) return []

  const slotFade = Math.min(SLOT_FADE_SEC, slot.lengthSec / 3)
  const source = { kind: "music", opfsPath: pick.opfsPath, credit: pick.credit } as const

  const oneShot = (durationSec: number, index: number, fadeIn: number, fadeOut: number): Clip => ({
    id: `${slot.id}:${index}`,
    source,
    inSec: slot.inSec,
    outSec: slot.inSec + durationSec,
    atSec: atSec + index * (available - LOOP_CROSSFADE_SEC),
    gainDb: slot.gainDb,
    fadeInSec: Math.min(fadeIn, durationSec / 2),
    fadeOutSec: Math.min(fadeOut, durationSec / 2),
    duck: slot.duck ? "under-speech" : "none",
  })

  const loopable = available > LOOP_CROSSFADE_SEC * 2
  if (available >= slot.lengthSec || !loopable) {
    const durationSec = Math.min(available, slot.lengthSec)
    return [oneShot(durationSec, 0, slotFade, slotFade)]
  }

  // Each repeat after the first starts a crossfade early, so it advances the timeline by
  // `available - LOOP_CROSSFADE_SEC` rather than by its whole length.
  const clips: Clip[] = []
  const stride = available - LOOP_CROSSFADE_SEC
  for (let index = 0; index < MAX_SEGMENTS; index += 1) {
    const startsAt = index * stride
    const remaining = slot.lengthSec - startsAt
    if (remaining <= 0) break

    const last = remaining <= available
    const durationSec = last ? remaining : available
    clips.push(
      oneShot(
        durationSec,
        index,
        index === 0 ? slotFade : LOOP_CROSSFADE_SEC,
        last ? slotFade : LOOP_CROSSFADE_SEC,
      ),
    )
    if (last) break
  }
  return clips
}

// A break with `pauseSpeech` opens real silence under it and slides everything after it later.
// Derived rather than stored, like the cue track: the render calls `applySpeechBreaks` once at
// its boundary and reads the returned session everywhere.

/** A break asking for a real pause, and playing — so the gap and the music appear together. */
const isPausingBreak = (session: Session, slot: MusicSlot): boolean =>
  slot.kind === "break" && !!slot.pauseSpeech && playable(session, slot)

const openGap = (clips: Clip[], atSec: number, lengthSec: number, tag: string): Clip[] => {
  const out: Clip[] = []
  for (const clip of clips) {
    if (clip.atSec >= atSec) {
      out.push({ ...clip, atSec: clip.atSec + lengthSec })
    } else if (clipEndSec(clip) > atSec) {
      const [left, right] = splitClipAt(clip, atSec, `${clip.id}:break:${tag}`)
      out.push(left)
      if (right) out.push({ ...right, atSec: right.atSec + lengthSec })
    } else {
      out.push(clip)
    }
  }
  return out
}

/**
 * Each pausing break is rewritten to an absolute anchor at the gap it opened, so re-applying
 * this is a no-op. Breaks are processed in timeline order: a second gap must sit after the
 * first one has already moved it.
 */
export const applySpeechBreaks = (session: Session): Session => {
  const breaks = session.musicSlots
    .filter((slot) => isPausingBreak(session, slot))
    .map((slot) => ({ slot, atSec: resolveAnchorSec(session, slot)! }))
    .sort((a, b) => a.atSec - b.atSec)
  if (breaks.length === 0) return session

  let clips = speechTrack(session).clips
  const gapAtBySlot = new Map<string, number>()
  let offset = 0
  for (const { slot, atSec } of breaks) {
    const gapAt = atSec + offset
    clips = openGap(clips, gapAt, slot.lengthSec, slot.id)
    gapAtBySlot.set(slot.id, gapAt)
    offset += slot.lengthSec
  }

  return {
    ...session,
    tracks: session.tracks.map((t) => (t.kind === "speech" ? { ...t, clips } : t)),
    musicSlots: session.musicSlots.map((slot) => {
      const gapAt = gapAtBySlot.get(slot.id)
      return gapAt === undefined
        ? slot
        : { ...slot, anchor: { kind: "absolute", atSec: gapAt }, pauseSpeech: false }
    }),
  }
}

export const cueClipsFromSlots = (session: Session): Clip[] =>
  session.musicSlots.flatMap((slot) => clipsForSlot(session, slot))

/** Whether anything plays under the speech — drives the two-stage render and the bitrate. */
export const hasMusic = (session: Session): boolean =>
  session.musicSlots.some((slot) => playable(session, slot))

/**
 * Music anchored to `speech-end` is measured against the speech alone, so the rendered length
 * is one pass and not a fixed point.
 */
export const programmeDurationSec = (session: Session): number => {
  let end = speechDurationSec(session)
  for (const clip of cueClipsFromSlots(session)) end = Math.max(end, clipEndSec(clip))
  return end
}

export const musicPathsInUse = (session: Session): Set<string> => {
  const paths = new Set<string>()
  for (const slot of session.musicSlots) {
    if (playable(session, slot)) paths.add(slot.pick!.opfsPath)
  }
  return paths
}

/** CC-BY picks that actually play, one entry per distinct track. CC0 asks for no attribution. */
export const creditsToPublish = (session: Session) => {
  const bySourceUrl = new Map<string, MusicPick["credit"]>()
  for (const slot of session.musicSlots) {
    if (!playable(session, slot)) continue
    const credit = slot.pick!.credit
    if (credit.license !== "by") continue
    bySourceUrl.set(credit.sourceUrl, credit)
  }
  return [...bySourceUrl.values()]
}
