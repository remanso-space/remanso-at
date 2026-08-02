import { describe, expect, it } from "vitest"

import { addTake, newSession } from "./edl"
import type { MusicPick, Session, Take } from "./edl.types"
import { bitrateFor, contentTier, minutesAtTier } from "./mediaCodec"
import { addSlot, newSlot, updateSlot } from "./musicSlots"

// Only the pure arithmetic is tested here; decode/encode are WebCodecs and verified in the
// app.

const take = (id: string, durationSec: number): Take => ({
  id,
  opfsPath: `takes/${id}.webm`,
  durationSec,
  peaksPath: `peaks/${id}.bin`,
  flags: [],
  label: id,
})

const withTake = (durationSec: number): Session =>
  addTake(newSession("s", "e"), take("t1", durationSec), "c1")

const pick = (sourceDurationSec: number): MusicPick => ({
  opfsPath: "cues/x.mp3",
  sourceDurationSec,
  credit: {
    title: "Pad",
    creator: "someone",
    license: "cc0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://freesound.org/x",
  },
})

/** A filled slot of `lengthSec`, anchored at the start of a `programmeSec`-long take. */
const withSlot = (programmeSec: number, lengthSec: number): Session => {
  const slot = newSlot("intro", "s1")
  const s = addSlot(withTake(programmeSec), slot)
  return updateSlot(s, slot.id, { lengthSec, pick: pick(300) })
}

describe("bitrateFor", () => {
  it("prefers the tier target for a short episode", () => {
    expect(bitrateFor(60, "speech")).toBe(64_000)
    expect(bitrateFor(60, "occasional-cue")).toBe(96_000)
    expect(bitrateFor(60, "music-heavy")).toBe(128_000)
  })

  it("drops below the tier target when duration forces it under the 50 MB ceiling", () => {
    // A very long music-heavy episode cannot hold 128 kbps in 50 MB.
    const long = bitrateFor(3 * 3600, "music-heavy")
    expect(long).toBeLessThan(128_000)
    expect(long).toBeGreaterThanOrEqual(32_000)
  })

  it("defaults to the speech tier, matching the pre-slice-6 caller", () => {
    expect(bitrateFor(60)).toBe(bitrateFor(60, "speech"))
  })
})

describe("minutesAtTier", () => {
  it("gives more minutes for speech than for music", () => {
    expect(minutesAtTier("speech")).toBeGreaterThan(minutesAtTier("music-heavy"))
    // Sanity against the plan's figures: ~104 min speech, ~52 min music-heavy in 50 MB.
    expect(minutesAtTier("speech")).toBeGreaterThan(90)
    expect(minutesAtTier("music-heavy")).toBeLessThan(60)
  })
})

describe("contentTier", () => {
  it("is speech-only with no music", () => {
    expect(contentTier(withTake(60))).toBe("speech")
  })

  it("is occasional-cue for a short intro under a long episode", () => {
    expect(contentTier(withSlot(120, 2))).toBe("occasional-cue")
  })

  it("is music-heavy for music under most of the programme", () => {
    expect(contentTier(withSlot(60, 55))).toBe("music-heavy")
  })

  it("ignores a slot nobody filled", () => {
    const s = addSlot(withTake(60), newSlot("intro", "s1"))
    expect(contentTier(s)).toBe("speech")
  })
})
