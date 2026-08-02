import { describe, expect, it } from "vitest"

import {
  addTake,
  clipDurationSec,
  DEFAULT_CHAIN,
  newSession,
  projectChapterToTimeline,
  speechTrack,
  splitClipAt,
  timelineDurationSec,
  trimClip,
} from "./edl"
import type { Take } from "./edl.types"

const take = (id: string, durationSec: number): Take => ({
  id,
  opfsPath: `takes/${id}.webm`,
  durationSec,
  peaksPath: `peaks/${id}.bin`,
  flags: [],
  label: id,
})

describe("newSession", () => {
  it("starts with an empty speech and cue track and the default chain", () => {
    const s = newSession("s1", "Episode 1")

    expect(s.tracks.map((t) => t.kind)).toEqual(["speech", "cue"])
    expect(s.tracks.every((t) => t.clips.length === 0)).toBe(true)
    expect(s.chain).toEqual(DEFAULT_CHAIN)
    expect(s.sampleRate).toBe(48_000)
    expect(timelineDurationSec(s)).toBe(0)
  })

  it("does not share the chain object with the constant", () => {
    const s = newSession("s1", "e")
    s.chain.hpfHz = 120

    expect(DEFAULT_CHAIN.hpfHz).toBe(80)
  })
})

describe("addTake", () => {
  it("appends the take and a full-length speech clip at the timeline end", () => {
    const s = addTake(newSession("s1", "e"), take("t1", 60), "c1")

    expect(s.takes).toHaveLength(1)
    const clips = speechTrack(s).clips
    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatchObject({ id: "c1", inSec: 0, outSec: 60, atSec: 0 })
    expect(timelineDurationSec(s)).toBe(60)
  })

  it("lays a second take after the first, not on top of it", () => {
    let s = addTake(newSession("s1", "e"), take("t1", 60), "c1")
    s = addTake(s, take("t2", 30), "c2")

    expect(speechTrack(s).clips.map((c) => c.atSec)).toEqual([0, 60])
    expect(timelineDurationSec(s)).toBe(90)
  })

  it("does not mutate the input session", () => {
    const s0 = newSession("s1", "e")
    addTake(s0, take("t1", 60), "c1")

    expect(s0.takes).toHaveLength(0)
    expect(speechTrack(s0).clips).toHaveLength(0)
  })
})

describe("trimClip", () => {
  it("tightens the source window", () => {
    const [clip] = speechTrack(addTake(newSession("s", "e"), take("t1", 60), "c1")).clips
    const trimmed = trimClip(clip, 5, 50)

    expect(trimmed.inSec).toBe(5)
    expect(trimmed.outSec).toBe(50)
    expect(clipDurationSec(trimmed)).toBe(45)
  })

  it("clamps to the existing window and never expands it", () => {
    const clip = { ...speechTrack(addTake(newSession("s", "e"), take("t1", 60), "c1")).clips[0] }
    const trimmed = trimClip({ ...clip, inSec: 10, outSec: 40 }, 0, 100)

    expect(trimmed.inSec).toBe(10)
    expect(trimmed.outSec).toBe(40)
  })
})

describe("splitClipAt", () => {
  const only = () => speechTrack(addTake(newSession("s", "e"), take("t1", 60), "c1")).clips[0]

  it("cuts one clip into two that share the source and abut on the timeline", () => {
    const [left, right] = splitClipAt(only(), 20, "c2") as [
      ReturnType<typeof only>,
      ReturnType<typeof only>,
    ]

    expect(left.id).toBe("c1")
    expect(left.atSec).toBe(0)
    expect(left.outSec).toBe(20)
    expect(right.id).toBe("c2")
    expect(right.atSec).toBe(20)
    expect(right.inSec).toBe(20)
    expect(right.outSec).toBe(60)
    expect(clipDurationSec(left) + clipDurationSec(right)).toBe(60)
  })

  it("splits by source offset, not timeline seconds, when the clip is placed late", () => {
    // A trimmed clip placed at atSec=100 with source window [10,40): a cut at
    // timeline 115 lands 15s in, i.e. source second 25.
    const clip = { ...only(), inSec: 10, outSec: 40, atSec: 100 }
    const [left, right] = splitClipAt(clip, 115, "c2") as [typeof clip, typeof clip]

    expect(left.outSec).toBe(25)
    expect(right.inSec).toBe(25)
    expect(right.atSec).toBe(115)
  })

  it("leaves the clip whole when the cut is outside its span", () => {
    expect(splitClipAt(only(), 0, "c2")).toHaveLength(1)
    expect(splitClipAt(only(), 60, "c2")).toHaveLength(1)
    expect(splitClipAt(only(), 99, "c2")).toHaveLength(1)
  })
})

describe("projectChapterToTimeline", () => {
  it("maps a take-relative mark straight through an untrimmed clip", () => {
    const s = addTake(newSession("s", "e"), take("t1", 60), "c1")

    expect(projectChapterToTimeline(s, { takeId: "t1", atTakeSec: 30 })).toBe(30)
  })

  it("survives a head trim: the mark shifts with the clip's new placement", () => {
    const s0 = addTake(newSession("s", "e"), take("t1", 60), "c1")
    // Head-trimmed to source [12,60) but still rendered from timeline 0.
    const s = {
      ...s0,
      tracks: s0.tracks.map((t) =>
        t.kind === "speech" ? { ...t, clips: [{ ...t.clips[0], inSec: 12, atSec: 0 }] } : t,
      ),
    }

    // A mark at take second 20 is 8s into the kept audio.
    expect(projectChapterToTimeline(s, { takeId: "t1", atTakeSec: 20 })).toBe(8)
  })

  it("returns null when the mark fell in audio that was trimmed out", () => {
    const s0 = addTake(newSession("s", "e"), take("t1", 60), "c1")
    const s = {
      ...s0,
      tracks: s0.tracks.map((t) =>
        t.kind === "speech" ? { ...t, clips: [{ ...t.clips[0], inSec: 12 }] } : t,
      ),
    }

    expect(projectChapterToTimeline(s, { takeId: "t1", atTakeSec: 5 })).toBeNull()
  })

  it("resolves a mark to whichever split clip still contains it", () => {
    const s0 = addTake(newSession("s", "e"), take("t1", 60), "c1")
    const [left, right] = splitClipAt(s0.tracks[0].clips[0], 20, "c2")
    // Drop the left clip and ripple the right back to timeline 0 (a rejected region).
    const s = {
      ...s0,
      tracks: s0.tracks.map((t) =>
        t.kind === "speech" ? { ...t, clips: [{ ...(right ?? left), atSec: 0 }] } : t,
      ),
    }

    // Take second 45 is in the surviving [20,60) clip, now 25s into a timeline from 0.
    expect(projectChapterToTimeline(s, { takeId: "t1", atTakeSec: 45 })).toBe(25)
    // Take second 5 was in the dropped left clip.
    expect(projectChapterToTimeline(s, { takeId: "t1", atTakeSec: 5 })).toBeNull()
  })
})
