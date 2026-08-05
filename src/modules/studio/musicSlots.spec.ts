import { describe, expect, it } from "vitest"

import {
  addChapter,
  addTake,
  clipDurationSec,
  clipEndSec,
  newSession,
  projectChapterToTimeline,
  speechTrack,
} from "./edl"
import type { MusicPick, Session, Take } from "./edl.types"
import {
  addSlot,
  applySpeechBreaks,
  clipsForSlot,
  creditsToPublish,
  cueClipsFromSlots,
  fillSlot,
  hasMusic,
  musicPathsInUse,
  newSlot,
  programmeDurationSec,
  removeSlot,
  resolveAnchorSec,
  SLOT_DEFAULTS,
  updateSlot,
} from "./musicSlots"

const take = (id: string, durationSec: number): Take => ({
  id,
  opfsPath: `takes/${id}.webm`,
  durationSec,
  peaksPath: `peaks/${id}.bin`,
  flags: [],
  label: id,
})

const pick = (sourceDurationSec: number, over: Partial<MusicPick["credit"]> = {}): MusicPick => ({
  opfsPath: "cues/pad.mp3",
  sourceDurationSec,
  credit: {
    title: "Pad",
    creator: "someone",
    license: "cc0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://freesound.org/pad",
    ...over,
  },
})

/** A 60 s programme with one filled slot of the given kind. */
const withSlot = (
  kind: "intro" | "break" | "outro",
  sourceSec: number,
  patch: Partial<{ lengthSec: number }> = {},
): { session: Session; slotId: string } => {
  const base = addTake(newSession("s", "e"), take("t1", 60), "c1")
  const slot = newSlot(kind, "m1")
  let session = addSlot(base, slot)
  session = fillSlot(session, slot.id, pick(sourceSec))
  if (patch.lengthSec !== undefined) {
    session = updateSlot(session, slot.id, { lengthSec: patch.lengthSec })
  }
  return { session, slotId: slot.id }
}

describe("slot defaults", () => {
  it("opens loud and unducked, breaks quiet and ducked", () => {
    expect(SLOT_DEFAULTS.intro.duck).toBe(false)
    expect(SLOT_DEFAULTS.break.duck).toBe(true)
    expect(SLOT_DEFAULTS.break.gainDb).toBeLessThan(SLOT_DEFAULTS.intro.gainDb)
    expect(SLOT_DEFAULTS.outro.anchor).toEqual({ kind: "speech-end" })
  })

  it("makes a slot with no track picked yet", () => {
    expect(newSlot("intro", "m1").pick).toBeNull()
  })
})

describe("slot operations", () => {
  it("adds, patches and removes without touching the speech track", () => {
    const base = addTake(newSession("s", "e"), take("t1", 10), "c1")
    const added = addSlot(base, newSlot("intro", "m1"))
    expect(added.musicSlots.length).toBe(1)
    expect(added.tracks).toBe(base.tracks)

    const patched = updateSlot(added, "m1", { lengthSec: 12 })
    expect(patched.musicSlots[0].lengthSec).toBe(12)
    expect(added.musicSlots[0].lengthSec).toBe(SLOT_DEFAULTS.intro.lengthSec) // pure

    expect(removeSlot(patched, "m1").musicSlots).toEqual([])
  })

  it("resets the in-point when a new track fills the slot", () => {
    const { session, slotId } = withSlot("intro", 30)
    const seeked = updateSlot(session, slotId, { inSec: 12 })
    const refilled = fillSlot(seeked, slotId, pick(30))
    expect(refilled.musicSlots[0].inSec).toBe(0)
  })
})

describe("resolveAnchorSec", () => {
  it("reads an absolute anchor, never negative", () => {
    const { session } = withSlot("intro", 30)
    const s = updateSlot(session, "m1", { anchor: { kind: "absolute", atSec: -5 } })
    expect(resolveAnchorSec(s, s.musicSlots[0])).toBe(0)
  })

  it("puts a speech-end anchor after the last word", () => {
    const { session } = withSlot("outro", 30)
    expect(resolveAnchorSec(session, session.musicSlots[0])).toBe(60)
  })

  it("follows a chapter mark, and resolves to nothing once the mark is edited out", () => {
    const { session } = withSlot("break", 30)
    const s = addChapter(session, { takeId: "t1", atTakeSec: 20 })
    expect(resolveAnchorSec(s, s.musicSlots[0])).toBe(20)

    const gone = addChapter(session, { takeId: "t1", atTakeSec: 900 })
    expect(resolveAnchorSec(gone, gone.musicSlots[0])).toBeNull()
  })

  it("resolves to nothing when the chapter it points at does not exist", () => {
    const { session } = withSlot("break", 30)
    expect(resolveAnchorSec(session, session.musicSlots[0])).toBeNull()
  })
})

describe("clipsForSlot", () => {
  it("projects one clip when the track covers the slot", () => {
    const { session } = withSlot("intro", 30, { lengthSec: 8 })
    const clips = clipsForSlot(session, session.musicSlots[0])

    expect(clips.length).toBe(1)
    expect(clips[0].source).toEqual({
      kind: "music",
      opfsPath: "cues/pad.mp3",
      credit: pick(30).credit,
    })
    expect(clips[0].atSec).toBe(0)
    expect(clipDurationSec(clips[0])).toBe(8)
    expect(clips[0].gainDb).toBe(SLOT_DEFAULTS.intro.gainDb)
    expect(clips[0].duck).toBe("none")
    // A slot fade, clamped to a third of the slot.
    expect(clips[0].fadeInSec).toBe(1)
    expect(clips[0].fadeOutSec).toBe(1)
  })

  it("clamps its fades on a very short slot", () => {
    const { session } = withSlot("intro", 30, { lengthSec: 1.5 })
    const clip = clipsForSlot(session, session.musicSlots[0])[0]
    expect(clip.fadeInSec).toBeCloseTo(0.5, 6)
    expect(clip.fadeOutSec).toBeCloseTo(0.5, 6)
  })

  it("marks a ducked slot for the speech envelope", () => {
    const { session } = withSlot("break", 30, { lengthSec: 4 })
    const s = addChapter(session, { takeId: "t1", atTakeSec: 20 })
    const clip = clipsForSlot(s, s.musicSlots[0])[0]
    expect(clip.atSec).toBe(20)
    expect(clip.duck).toBe("under-speech")
  })

  it("loops a short track to fill a long slot, ending exactly on the slot's length", () => {
    // 10 s of source under a 28 s slot, seams crossfading by 0.5 s → stride 9.5 s. Three
    // repeats reach 28 s (0…10, 9.5…19.5, 19…28), the last one cut short to land on it.
    const { session } = withSlot("intro", 10, { lengthSec: 28 })
    const clips = clipsForSlot(session, session.musicSlots[0])

    expect(clips.length).toBe(3)
    expect(clips.map((c) => c.atSec)).toEqual([0, 9.5, 19])
    expect(clipEndSec(clips[clips.length - 1])).toBeCloseTo(28, 6)
    // Every repeat reads the same window of the source.
    for (const clip of clips) expect(clip.inSec).toBe(0)
    // Seams cross: each repeat starts before the previous one ends.
    for (let i = 1; i < clips.length; i += 1) {
      expect(clips[i].atSec).toBeLessThan(clipEndSec(clips[i - 1]))
    }
  })

  it("crossfades at the seams and keeps the slot's own fade at each end", () => {
    const { session } = withSlot("intro", 10, { lengthSec: 28 })
    const clips = clipsForSlot(session, session.musicSlots[0])
    const last = clips.length - 1

    expect(clips[0].fadeInSec).toBe(1) // the slot opening
    expect(clips[0].fadeOutSec).toBe(0.5) // into the next repeat
    expect(clips[1].fadeInSec).toBe(0.5)
    expect(clips[last].fadeOutSec).toBe(1) // the slot closing
  })

  it("plays a track shorter than two crossfades once instead of stuttering", () => {
    const { session } = withSlot("intro", 0.8, { lengthSec: 10 })
    const clips = clipsForSlot(session, session.musicSlots[0])
    expect(clips.length).toBe(1)
    expect(clipDurationSec(clips[0])).toBeCloseTo(0.8, 6)
  })

  it("reads from the slot's in-point, looping only what is left of the track", () => {
    // In at 25 s of a 30 s track leaves 5 s, so an 8 s slot loops those 5 s.
    const { session } = withSlot("intro", 30, { lengthSec: 8 })
    const seeked = updateSlot(session, "m1", { inSec: 25 })
    const clips = clipsForSlot(seeked, seeked.musicSlots[0])

    expect(clips.length).toBe(2)
    expect(clips[0].inSec).toBe(25)
    expect(clips[0].outSec).toBe(30)
    expect(clipEndSec(clips[1])).toBeCloseTo(8, 6)
  })

  it("projects nothing when the in-point is at or past the end of the track", () => {
    const { session } = withSlot("intro", 30, { lengthSec: 8 })
    const past = updateSlot(session, "m1", { inSec: 30 })
    expect(clipsForSlot(past, past.musicSlots[0])).toEqual([])
  })

  it("projects nothing for an unfilled or zero-length slot", () => {
    const base = addTake(newSession("s", "e"), take("t1", 60), "c1")
    const empty = addSlot(base, newSlot("intro", "m1"))
    expect(clipsForSlot(empty, empty.musicSlots[0])).toEqual([])

    const { session } = withSlot("intro", 30, { lengthSec: 0 })
    expect(clipsForSlot(session, session.musicSlots[0])).toEqual([])
  })
})

describe("the projected cue track", () => {
  it("concatenates every slot's clips and gives unique ids", () => {
    const { session } = withSlot("intro", 30, { lengthSec: 8 })
    const second = newSlot("outro", "m2")
    let s = addSlot(session, second)
    s = fillSlot(s, second.id, pick(30))

    const clips = cueClipsFromSlots(s)
    expect(clips.length).toBe(2)
    expect(new Set(clips.map((c) => c.id)).size).toBe(2)
  })

  it("hasMusic is false until a slot that lands somewhere is filled", () => {
    const base = addTake(newSession("s", "e"), take("t1", 60), "c1")
    expect(hasMusic(base)).toBe(false)
    expect(hasMusic(addSlot(base, newSlot("intro", "m1")))).toBe(false)
    expect(hasMusic(withSlot("intro", 30).session)).toBe(true)
    // A break with no chapter to hang off lands nowhere.
    expect(hasMusic(withSlot("break", 30).session)).toBe(false)
  })

  it("programmeDurationSec covers an outro running past the last word", () => {
    const { session } = withSlot("outro", 30, { lengthSec: 10 })
    expect(programmeDurationSec(session)).toBe(70)
  })

  it("programmeDurationSec is the speech alone when nothing plays under it", () => {
    const base = addTake(newSession("s", "e"), take("t1", 60), "c1")
    expect(programmeDurationSec(base)).toBe(60)
  })

  it("lists each track to decode once, however many slots play it", () => {
    const { session } = withSlot("intro", 30, { lengthSec: 8 })
    const second = newSlot("outro", "m2")
    let s = addSlot(session, second)
    s = fillSlot(s, second.id, pick(30))
    expect([...musicPathsInUse(s)]).toEqual(["cues/pad.mp3"])
  })
})

describe("applySpeechBreaks (real breaks that pause the recording)", () => {
  // A 60 s take, one filled break on a chapter at 20 s, pausing for `lengthSec`.
  const breakSession = (lengthSec = 4, atTakeSec = 20): Session => {
    let s = addTake(newSession("s", "e"), take("t1", 60), "c1")
    const slot = newSlot("break", "m1")
    s = addSlot(s, slot)
    s = fillSlot(s, slot.id, pick(30))
    s = addChapter(s, { takeId: "t1", atTakeSec })
    return updateSlot(s, slot.id, {
      lengthSec,
      anchor: { kind: "chapter", chapterIndex: 0 },
      pauseSpeech: true,
    })
  }

  it("leaves the session untouched when no break pauses", () => {
    const off = updateSlot(breakSession(), "m1", { pauseSpeech: false })
    expect(applySpeechBreaks(off)).toBe(off)
  })

  it("does not pause a break with no track picked yet", () => {
    let s = addTake(newSession("s", "e"), take("t1", 60), "c1")
    s = addSlot(s, newSlot("break", "m1"))
    s = addChapter(s, { takeId: "t1", atTakeSec: 20 })
    s = updateSlot(s, "m1", { anchor: { kind: "chapter", chapterIndex: 0 }, pauseSpeech: true })
    expect(applySpeechBreaks(s)).toBe(s)
  })

  it("opens a real silence at the break and pushes the rest later", () => {
    const eff = applySpeechBreaks(breakSession(4, 20))
    const clips = speechTrack(eff).clips
    expect(clips.length).toBe(2)
    expect(clipEndSec(clips[0])).toBeCloseTo(20, 6) // speech stops at the break
    expect(clips[1].atSec).toBeCloseTo(24, 6) // and resumes 4 s later — a real gap
    expect(programmeDurationSec(eff)).toBeCloseTo(64, 6)
  })

  it("plays the break's own music into the gap it opened", () => {
    const cues = cueClipsFromSlots(applySpeechBreaks(breakSession(4, 20)))
    expect(cues.length).toBe(1)
    expect(cues[0].atSec).toBeCloseTo(20, 6)
    expect(clipEndSec(cues[0])).toBeCloseTo(24, 6)
  })

  it("moves a later chapter and a speech-end outro past the gap", () => {
    let s = breakSession(4, 20)
    s = addChapter(s, { takeId: "t1", atTakeSec: 40 })
    const outro = newSlot("outro", "m2")
    s = addSlot(s, outro)
    s = fillSlot(s, outro.id, pick(30))
    const eff = applySpeechBreaks(s)

    const later = eff.chapters.find((c) => c.atTakeSec === 40)!
    expect(projectChapterToTimeline(eff, later)).toBeCloseTo(44, 6)
    const outroSlot = eff.musicSlots.find((m) => m.id === "m2")!
    expect(resolveAnchorSec(eff, outroSlot)).toBeCloseTo(64, 6)
  })

  it("stacks the offsets of two pausing breaks in timeline order", () => {
    let s = breakSession(4, 20)
    s = addChapter(s, { takeId: "t1", atTakeSec: 40 })
    const b2 = newSlot("break", "m2")
    s = addSlot(s, b2)
    s = fillSlot(s, b2.id, pick(30))
    const idx = s.chapters.findIndex((c) => c.atTakeSec === 40)
    s = updateSlot(s, b2.id, {
      lengthSec: 6,
      anchor: { kind: "chapter", chapterIndex: idx },
      pauseSpeech: true,
    })
    const eff = applySpeechBreaks(s)

    expect(programmeDurationSec(eff)).toBeCloseTo(70, 6) // 60 + 4 + 6
    const cues = cueClipsFromSlots(eff).sort((a, b) => a.atSec - b.atSec)
    expect(cues[0].atSec).toBeCloseTo(20, 6)
    expect(cues[1].atSec).toBeCloseTo(44, 6) // 40 shifted by the first 4 s gap
  })

  it("is idempotent — re-applying opens no further gaps", () => {
    const once = applySpeechBreaks(breakSession(4, 20))
    const twice = applySpeechBreaks(once)
    expect(programmeDurationSec(twice)).toBeCloseTo(programmeDurationSec(once), 6)
    expect(speechTrack(twice).clips.length).toBe(speechTrack(once).clips.length)
  })
})

describe("creditsToPublish", () => {
  it("publishes CC-BY and stays silent about CC0", () => {
    const { session } = withSlot("intro", 30)
    expect(creditsToPublish(session)).toEqual([]) // the fixture is CC0

    const by = fillSlot(session, "m1", pick(30, { license: "by", sourceUrl: "https://x/1" }))
    expect(creditsToPublish(by).map((c) => c.sourceUrl)).toEqual(["https://x/1"])
  })

  it("lists a track once even when two slots play it", () => {
    const { session } = withSlot("intro", 30)
    const by = fillSlot(session, "m1", pick(30, { license: "by", sourceUrl: "https://x/1" }))
    const second = newSlot("outro", "m2")
    let s = addSlot(by, second)
    s = fillSlot(s, second.id, pick(30, { license: "by", sourceUrl: "https://x/1" }))
    expect(creditsToPublish(s).length).toBe(1)
  })

  it("leaves out a slot that does not play", () => {
    const { session } = withSlot("break", 30) // no chapter → lands nowhere
    const by = fillSlot(session, "m1", pick(30, { license: "by", sourceUrl: "https://x/1" }))
    expect(creditsToPublish(by)).toEqual([])
  })
})
