import { describe, expect, it } from "vitest"

import { addBedClip, addCueFileClip, addRoomToneFill, addTake, newSession } from "./edl"
import type { Session, Take } from "./edl.types"
import { bitrateFor, contentTier, minutesAtTier } from "./mediaCodec"

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
  it("is speech-only with no cues", () => {
    expect(contentTier(withTake(60))).toBe("speech")
  })

  it("is occasional-cue for a short sting under a long episode", () => {
    const s = addCueFileClip(
      withTake(120),
      { opfsPath: "cues/x.mp3", atSec: 10, durationSec: 2 },
      "q1",
    )
    expect(contentTier(s)).toBe("occasional-cue")
  })

  it("is music-heavy for a bed under most of the programme", () => {
    const s = addBedClip(withTake(60), { bedId: "rain", seed: 1, atSec: 0, lengthSec: 55 }, "q1")
    expect(contentTier(s)).toBe("music-heavy")
  })

  it("ignores a room-tone fill: it is a floor, not music", () => {
    const s = addRoomToneFill(withTake(60), 1, "q1")
    expect(contentTier(s)).toBe("speech")
  })
})
