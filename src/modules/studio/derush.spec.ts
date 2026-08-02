import { describe, expect, it } from "vitest"

import {
  applyCuts,
  flagAfter,
  flagBefore,
  isTakeMuted,
  keptDurationForTake,
  keptRangesForTake,
  nextKeptSec,
  nextShuttleRate,
  rejectTakeRange,
  relayoutSpeech,
  removeTake,
  retakeRange,
  retakeRanges,
  setClipMuted,
  setTakeMuted,
  soloTake,
} from "./derush"
import { addTake, newSession, speechTrack, speechDurationSec } from "./edl"
import type { Marker, Session, Take } from "./edl.types"

const take = (id: string, durationSec: number, flags: Marker[] = []): Take => ({
  id,
  opfsPath: `takes/${id}.weba`,
  durationSec,
  peaksPath: `peaks/${id}.peaks`,
  flags,
  label: id,
})

/** One 10-second take laid full length on the speech track. */
const oneTake = (): Session => addTake(newSession("s", "Episode"), take("t1", 10), "c1")

const clips = (s: Session) => speechTrack(s).clips
const windows = (s: Session) => clips(s).map((c) => [c.inSec, c.outSec])
const placements = (s: Session) => clips(s).map((c) => c.atSec)

describe("rejectTakeRange", () => {
  it("splits a clip in two when the region lands inside it", () => {
    const after = rejectTakeRange(oneTake(), "t1", 4, 6)

    expect(windows(after)).toEqual([
      [0, 4],
      [6, 10],
    ])
  })

  it("ripples the survivors so the removed audio leaves no gap", () => {
    const after = rejectTakeRange(oneTake(), "t1", 4, 6)

    expect(placements(after)).toEqual([0, 4])
    expect(speechDurationSec(after)).toBe(8)
  })

  it("shortens rather than splits when the region touches an edge", () => {
    expect(windows(rejectTakeRange(oneTake(), "t1", 0, 2))).toEqual([[2, 10]])
    expect(windows(rejectTakeRange(oneTake(), "t1", 8, 10))).toEqual([[0, 8]])
  })

  it("drops a clip the region swallows whole", () => {
    const after = rejectTakeRange(oneTake(), "t1", 0, 10)

    expect(clips(after)).toEqual([])
    expect(speechDurationSec(after)).toBe(0)
  })

  it("accepts the region in either order and ignores an empty one", () => {
    expect(windows(rejectTakeRange(oneTake(), "t1", 6, 4))).toEqual([
      [0, 4],
      [6, 10],
    ])
    expect(rejectTakeRange(oneTake(), "t1", 5, 5)).toEqual(oneTake())
  })

  it("leaves other takes' clips alone", () => {
    const two = addTake(oneTake(), take("t2", 5), "c2")
    const after = rejectTakeRange(two, "t1", 0, 10)

    expect(clips(after)).toHaveLength(1)
    expect(clips(after)[0].id).toBe("c2")
    expect(placements(after)).toEqual([0])
  })

  it("composes: a second reject on the split halves keeps both windows right", () => {
    const after = rejectTakeRange(rejectTakeRange(oneTake(), "t1", 4, 6), "t1", 1, 2)

    expect(windows(after)).toEqual([
      [0, 1],
      [2, 4],
      [6, 10],
    ])
    expect(placements(after)).toEqual([0, 1, 3])
  })
})

describe("applyCuts", () => {
  it("accepts every pause candidate in one edit", () => {
    const after = applyCuts(oneTake(), "t1", [
      { startSec: 0, endSec: 1 },
      { startSec: 5, endSec: 6 },
    ])

    expect(windows(after)).toEqual([
      [1, 5],
      [6, 10],
    ])
    expect(speechDurationSec(after)).toBe(8)
  })
})

describe("keptRangesForTake / keptDurationForTake", () => {
  it("reports what the EDL still covers, in take seconds", () => {
    const after = rejectTakeRange(oneTake(), "t1", 4, 6)

    expect(keptRangesForTake(after, "t1").map((r) => [r.inSec, r.outSec])).toEqual([
      [0, 4],
      [6, 10],
    ])
    expect(keptDurationForTake(after, "t1")).toBe(8)
  })

  it("does not count a muted clip as kept time", () => {
    const muted = setTakeMuted(oneTake(), "t1", true)

    expect(keptDurationForTake(muted, "t1")).toBe(0)
    expect(keptRangesForTake(muted, "t1")[0].muted).toBe(true)
  })
})

describe("retakeRange", () => {
  const onsets = [0, 3, 7]

  it("condemns the line that had just started when the button was pressed", () => {
    const t = take("t1", 10, [{ atTakeSec: 5, kind: "retake" }])

    expect(retakeRange(t, t.flags[0], onsets)).toEqual({ inSec: 3, outSec: 5 })
  })

  it("stops at the previous flag so two retakes in a row do not overlap", () => {
    const t = take("t1", 10, [
      { atTakeSec: 4, kind: "retake" },
      { atTakeSec: 5, kind: "retake" },
    ])

    expect(retakeRange(t, t.flags[1], onsets)).toEqual({ inSec: 4, outSec: 5 })
  })

  it("runs back to the start of the take when no onset precedes it", () => {
    const t = take("t1", 10, [{ atTakeSec: 2, kind: "retake" }])

    expect(retakeRange(t, t.flags[0], [3, 7])).toEqual({ inSec: 0, outSec: 2 })
  })

  it("condemns nothing for a plain mark or a zero-length region", () => {
    const t = take("t1", 10, [
      { atTakeSec: 5, kind: "mark" },
      { atTakeSec: 0, kind: "retake" },
    ])

    expect(retakeRange(t, t.flags[0], onsets)).toBeNull()
    expect(retakeRange(t, t.flags[1], onsets)).toBeNull()
  })

  it("collects every retake region, earliest first", () => {
    const t = take("t1", 10, [
      { atTakeSec: 8, kind: "retake" },
      { atTakeSec: 5, kind: "mark" },
      { atTakeSec: 4, kind: "retake" },
    ])

    expect(retakeRanges(t, onsets)).toEqual([
      { inSec: 3, outSec: 4 },
      { inSec: 7, outSec: 8 },
    ])
  })
})

describe("muting and best-of-N", () => {
  const twoTakes = () => addTake(oneTake(), take("t2", 6), "c2")

  it("a muted clip consumes no timeline time but stays in the EDL", () => {
    const after = setTakeMuted(twoTakes(), "t1", true)

    expect(clips(after)).toHaveLength(2)
    expect(speechDurationSec(after)).toBe(6)
    expect(placements(after)).toEqual([0, 0])
  })

  it("solo keeps one take and mutes the rest, reversibly", () => {
    const soloed = soloTake(twoTakes(), "t2")

    expect(isTakeMuted(soloed, "t1")).toBe(true)
    expect(isTakeMuted(soloed, "t2")).toBe(false)
    expect(isTakeMuted(setTakeMuted(soloed, "t1", false), "t1")).toBe(false)
  })

  it("muting one take does not disturb another take's clip mutes", () => {
    const perClip = setClipMuted(twoTakes(), "c2", true)
    const after = setTakeMuted(perClip, "t1", true)

    expect(isTakeMuted(after, "t2")).toBe(true)
  })
})

describe("removeTake", () => {
  const twoTakes = () => addTake(oneTake(), take("t2", 6), "c2")

  it("drops the take, its clips, and closes the timeline gap", () => {
    const after = removeTake(twoTakes(), "t1")

    expect(after.takes.map((t) => t.id)).toEqual(["t2"])
    expect(clips(after)).toHaveLength(1)
    expect(clips(after)[0].source).toEqual({ kind: "take", takeId: "t2" })
    // t2 ripples back to the start now that t1 is gone.
    expect(placements(after)).toEqual([0])
    expect(speechDurationSec(after)).toBe(6)
  })

  it("removes chapters dropped against the deleted take, keeping the others", () => {
    const withChapters = {
      ...twoTakes(),
      chapters: [
        { takeId: "t1", atTakeSec: 2 },
        { takeId: "t2", atTakeSec: 1 },
      ],
    }
    const after = removeTake(withChapters, "t1")
    expect(after.chapters).toEqual([{ takeId: "t2", atTakeSec: 1 }])
  })

  it("deleting the last take leaves an empty, playable EDL", () => {
    const after = removeTake(oneTake(), "t1")
    expect(after.takes).toHaveLength(0)
    expect(clips(after)).toHaveLength(0)
    expect(speechDurationSec(after)).toBe(0)
  })
})

describe("relayoutSpeech", () => {
  it("is idempotent on a laid-out session", () => {
    const laid = rejectTakeRange(oneTake(), "t1", 4, 6)

    expect(relayoutSpeech(laid)).toEqual(laid)
  })
})

describe("nextShuttleRate", () => {
  it("climbs the ladder while the direction holds", () => {
    expect(nextShuttleRate(0, 1)).toBe(1)
    expect(nextShuttleRate(1, 1)).toBe(2)
    expect(nextShuttleRate(2, 1)).toBe(4)
    expect(nextShuttleRate(4, 1)).toBe(4)
  })

  it("drops back to 1x the other way when the direction flips", () => {
    expect(nextShuttleRate(4, -1)).toBe(-1)
    expect(nextShuttleRate(-2, 1)).toBe(1)
  })

  it("mirrors the ladder in reverse", () => {
    expect(nextShuttleRate(-1, -1)).toBe(-2)
    expect(nextShuttleRate(-4, -1)).toBe(-4)
  })
})

describe("flagAfter / flagBefore", () => {
  const flags: Marker[] = [
    { atTakeSec: 2, kind: "mark" },
    { atTakeSec: 8, kind: "retake" },
    { atTakeSec: 5, kind: "mark" },
  ]

  it("finds the nearest flag in each direction, unsorted input and all", () => {
    expect(flagAfter(flags, 2)?.atTakeSec).toBe(5)
    expect(flagBefore(flags, 8)?.atTakeSec).toBe(5)
  })

  it("returns null at the ends", () => {
    expect(flagAfter(flags, 9)).toBeNull()
    expect(flagBefore(flags, 0)).toBeNull()
  })
})

describe("nextKeptSec", () => {
  const kept = keptRangesForTake(rejectTakeRange(oneTake(), "t1", 4, 6), "t1")

  it("stays put inside a kept range", () => {
    expect(nextKeptSec(kept, 2)).toBe(2)
  })

  it("jumps the removed region", () => {
    expect(nextKeptSec(kept, 5)).toBe(6)
  })

  it("returns null past the last kept second", () => {
    expect(nextKeptSec(kept, 10)).toBeNull()
  })

  it("skips muted ranges", () => {
    const muted = keptRangesForTake(setTakeMuted(oneTake(), "t1", true), "t1")

    expect(nextKeptSec(muted, 0)).toBeNull()
  })
})
