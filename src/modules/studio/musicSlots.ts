import { clipEndSec, projectChapterToTimeline, speechDurationSec } from "./edl"
import type { Clip, MusicPick, MusicSlot, Session, SlotAnchor, SlotKind } from "./edl.types"

// Music slots and the cue clips they project to (slice 7).
//
// A slot is what an author actually wants to say: "something calm under the intro". It names
// a moment, a length and a track, and nothing else. The clips the renderer needs — trimmed,
// faded, ducked, looped to fill — are *derived* from the slots on every read rather than
// stored beside them. That is the whole design: there is one place a slot's length lives, so
// editing it cannot leave a stale clip behind, and undo is a slot list snapshot.
//
// Looping lives here too, for the same reason. A 20 s track under a 60 s slot becomes three
// overlapping clips with a crossfade at each seam, which the assembler already knows how to
// mix (it sums clips and fades them). No renderer change, no loop state, and the seam maths
// is pinned by a spec instead of hiding inside the mix loop.

/** The crossfade at a loop seam. Long enough to hide the join, short enough not to smear. */
const LOOP_CROSSFADE_SEC = 0.5

/** A slot's own opening and closing fade, clamped to a third of its length. */
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
 * What each kind means in numbers. An intro opens the episode over the first words, so it is
 * loud and unducked; a break lands between chapters under speech that keeps going, so it is
 * quiet and ducked; an outro plays out after the last word and needs the room an intro has.
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

/** Patch one slot. Every panel control routes through here, so there is one write path. */
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
 * Where a slot lands on the timeline, or null when it lands nowhere. A chapter anchor whose
 * mark a trim removed resolves to null and the slot simply does not render — the same rule
 * chapters themselves follow, rather than silently sliding the music somewhere else.
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

/** A slot is playable once it has a track and a positive length that lands somewhere. */
const playable = (session: Session, slot: MusicSlot): boolean =>
  !!slot.pick && slot.lengthSec > 0 && resolveAnchorSec(session, slot) !== null

/**
 * The clips one slot projects to. One clip when the track is long enough to cover the slot;
 * otherwise the track repeated, each repeat overlapping the last by a crossfade, with the
 * final repeat cut short so the slot ends exactly on its length. A track shorter than two
 * crossfades cannot be looped without chewing its own fades, so it plays once and the slot
 * ends early rather than stuttering.
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

/** Every slot's clips, in slot order — the cue track, derived. */
export const cueClipsFromSlots = (session: Session): Clip[] =>
  session.musicSlots.flatMap((slot) => clipsForSlot(session, slot))

/** Whether anything plays under the speech — drives the two-stage render and the bitrate. */
export const hasMusic = (session: Session): boolean =>
  session.musicSlots.some((slot) => playable(session, slot))

/**
 * The rendered length: the speech, plus any music that runs past its end (an outro does, by
 * definition). Music anchored to `speech-end` is measured against the speech alone, so this
 * is one pass and not a fixed point.
 */
export const programmeDurationSec = (session: Session): number => {
  let end = speechDurationSec(session)
  for (const clip of cueClipsFromSlots(session)) end = Math.max(end, clipEndSec(clip))
  return end
}

/** OPFS paths the render will need decoded. One per distinct track, however many slots use it. */
export const musicPathsInUse = (session: Session): Set<string> => {
  const paths = new Set<string>()
  for (const slot of session.musicSlots) {
    if (playable(session, slot)) paths.add(slot.pick!.opfsPath)
  }
  return paths
}

/**
 * The credits the published record must carry: CC-BY picks that actually play, one entry per
 * distinct track. CC0 asks for no attribution, so it is deliberately left out of the record
 * rather than published as a courtesy the reader then has to wonder about.
 */
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
