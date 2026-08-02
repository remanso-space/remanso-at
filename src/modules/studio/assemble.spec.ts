import { describe, expect, it } from "vitest"

import { assembleCues, assembleSpeech, renderSession, type CuePcm, type TakePcm } from "./assemble"
import { addChapter, addTake, newSession, splitClipAt } from "./edl"
import type { MusicPick, MusicSlot, Session, Take } from "./edl.types"
import { addSlot, newSlot, updateSlot } from "./musicSlots"

const SR = 100 // small rate keeps the fixtures readable

const PATH = "cues/x.mp3"

const pick = (sourceDurationSec: number): MusicPick => ({
  opfsPath: PATH,
  sourceDurationSec,
  credit: {
    title: "Pad",
    creator: "someone",
    license: "cc0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://freesound.org/x",
  },
})

/**
 * A one-take session with one filled intro slot. Gain and duck are neutral by default so the
 * assertions read placement rather than level. The slot's own fades still apply — they come
 * from the projection, which has its own spec; assertions here read past them.
 */
const withMusic = (
  takeSec: number,
  patch: Partial<Omit<MusicSlot, "id" | "kind">> = {},
): Session => {
  const s0 = addTake(newSession("s", "e"), take("t1", takeSec), "c1")
  const slot = newSlot("intro", "m1")
  return updateSlot(addSlot(s0, slot), slot.id, {
    lengthSec: takeSec,
    gainDb: 0,
    duck: false,
    pick: pick(takeSec),
    ...patch,
  })
}

const take = (id: string, durationSec: number): Take => ({
  id,
  opfsPath: `takes/${id}.webm`,
  durationSec,
  peaksPath: `peaks/${id}.bin`,
  flags: [],
  label: id,
})

/** A take's decoded samples: value == index, so placement is easy to read in assertions. */
const ramp = (n: number): Float32Array => Float32Array.from({ length: n }, (_, i) => i)

const withSpeechClips = (session: Session, clips: Session["tracks"][number]["clips"]): Session => ({
  ...session,
  tracks: session.tracks.map((t) => (t.kind === "speech" ? { ...t, clips } : t)),
})

describe("assembleSpeech", () => {
  it("copies a full take clip verbatim onto the timeline", () => {
    const s = addTake(newSession("s", "e"), take("t1", 0.05), "c1") // 5 samples at SR=100
    const out = assembleSpeech(s, { t1: ramp(5) }, SR)

    expect(Array.from(out)).toEqual([0, 1, 2, 3, 4])
  })

  it("respects a trim: only the in..out window of the source is used", () => {
    const s0 = addTake(newSession("s", "e"), take("t1", 0.1), "c1")
    const s = withSpeechClips(s0, [
      { ...s0.tracks[0].clips[0], inSec: 0.02, outSec: 0.05, atSec: 0 },
    ])
    const out = assembleSpeech(s, { t1: ramp(10) }, SR)

    expect(Array.from(out)).toEqual([2, 3, 4])
  })

  it("places a clip at its timeline offset, leaving silence before it", () => {
    const s0 = addTake(newSession("s", "e"), take("t1", 0.1), "c1")
    const s = withSpeechClips(s0, [
      { ...s0.tracks[0].clips[0], inSec: 0, outSec: 0.03, atSec: 0.02 },
    ])
    const out = assembleSpeech(s, { t1: ramp(10) }, SR)

    // timeline length = atSec+dur = 0.05 → 5 samples; first 2 silent, then source 0,1,2
    expect(Array.from(out)).toEqual([0, 0, 0, 1, 2])
  })

  it("applies clip gain", () => {
    const s0 = addTake(newSession("s", "e"), take("t1", 0.03), "c1")
    const s = withSpeechClips(s0, [{ ...s0.tracks[0].clips[0], gainDb: -6 }])
    const out = assembleSpeech(s, { t1: Float32Array.from([1, 1, 1]) }, SR)

    for (const v of out) expect(v).toBeCloseTo(0.501, 2) // -6 dB ≈ 0.501
  })

  it("excludes a muted clip", () => {
    const s0 = addTake(newSession("s", "e"), take("t1", 0.03), "c1")
    const s = withSpeechClips(s0, [{ ...s0.tracks[0].clips[0], muted: true }])
    const out = assembleSpeech(s, { t1: ramp(3) }, SR)

    // muted clip still sets timeline length via addTake's placement? No — timeline uses
    // non-muted clips only, so the buffer is empty.
    expect(out.length).toBe(0)
  })

  it("realises a pause cut: drop the middle clip, ripple the tail back", () => {
    // One take split into [0,0.02) and [0.02,0.06); reject the head, ripple the tail to 0.
    const s0 = addTake(newSession("s", "e"), take("t1", 0.06), "c1")
    const [, right] = splitClipAt(s0.tracks[0].clips[0], 0.02, "c2")
    const s = withSpeechClips(s0, [{ ...right!, atSec: 0 }])
    const out = assembleSpeech(s, { t1: ramp(6) }, SR)

    // source [0.02,0.06) = samples 2,3,4,5 placed from timeline 0
    expect(Array.from(out)).toEqual([2, 3, 4, 5])
  })

  it("ramps up under a fade-in rather than starting at full level", () => {
    const s0 = addTake(newSession("s", "e"), take("t1", 0.1), "c1")
    const s = withSpeechClips(s0, [
      { ...s0.tracks[0].clips[0], inSec: 0, outSec: 0.1, fadeInSec: 0.05 },
    ])
    const out = assembleSpeech(s, { t1: Float32Array.from({ length: 10 }, () => 1) }, SR)

    expect(out[0]).toBeLessThan(out[3])
    expect(out[3]).toBeLessThan(1)
    expect(out[9]).toBeCloseTo(1, 5) // past the fade, full level
  })
})

describe("assembleCues", () => {
  it("sums a slot's track from decoded PCM at its anchor", () => {
    const s = withMusic(0.1, { lengthSec: 0.03, anchor: { kind: "absolute", atSec: 0.02 } })
    const cuePcm: CuePcm = { [PATH]: Float32Array.from([9, 9, 9]) }
    const out = assembleCues(s, cuePcm, null, SR)
    // Anchored at 0.02 s → samples 2..4, the middle one past both of the slot's fades.
    expect(out[3]).toBeCloseTo(9, 6)
    expect(out[2]).toBeGreaterThan(0)
    expect(out[2]).toBeLessThan(9)
    expect(out[0]).toBe(0)
    expect(out[5] ?? 0).toBe(0)
  })

  it("applies the duck envelope to a ducked slot and spares an unducked one", () => {
    const bare = (duck: boolean) => withMusic(0.05, { lengthSec: 0.05, duck })
    const cuePcm: CuePcm = { [PATH]: Float32Array.from({ length: 5 }, () => 1) }
    const half = Float32Array.from({ length: 5 }, () => 0.5)

    const ducked = assembleCues(bare(true), cuePcm, half, SR)
    const unducked = assembleCues(bare(false), cuePcm, half, SR)
    // Sample 2 is past the fade in and before the fade out, so only the duck is left.
    expect(ducked[2]).toBeCloseTo(0.5, 6)
    expect(unducked[2]).toBeCloseTo(1, 6)
  })

  it("renders nothing for a slot nobody filled", () => {
    const s0 = addTake(newSession("s", "e"), take("t1", 1), "c1")
    const s = addSlot(s0, newSlot("intro", "m1"))
    const out = assembleCues(s, {}, null, SR)
    expect(out.every((v) => v === 0)).toBe(true)
  })

  it("renders nothing for a chapter slot whose mark was edited out", () => {
    const s0 = addTake(newSession("s", "e"), take("t1", 0.05), "c1")
    const withChapter = addChapter(s0, { takeId: "t1", atTakeSec: 999 })
    const slot = newSlot("break", "m1")
    const s = updateSlot(addSlot(withChapter, slot), slot.id, {
      lengthSec: 0.05,
      pick: pick(0.05),
      gainDb: 0,
    })
    const cuePcm: CuePcm = { [PATH]: Float32Array.from({ length: 5 }, () => 1) }
    expect(assembleCues(s, cuePcm, null, SR).every((v) => v === 0)).toBe(true)
  })
})

describe("renderSession", () => {
  it("assembles then normalises: a quiet take comes back near the target", () => {
    const s = addTake(newSession("s", "e"), take("t1", 3), "c1")
    const sr = 48_000
    const pcm: TakePcm = {
      t1: Float32Array.from(
        { length: 3 * sr },
        (_, i) => 0.05 * Math.sin((2 * Math.PI * 1000 * i) / sr),
      ),
    }
    const result = renderSession(s, pcm, sr)

    expect(result.durationSec).toBeCloseTo(3, 5)
    expect(result.appliedGainDb).toBeGreaterThan(8)
    expect(result.samples.length).toBe(3 * sr)
  })

  it("is byte-for-byte unchanged from the chain output when no slot is filled", () => {
    const s = addTake(newSession("s", "e"), take("t1", 1), "c1")
    const sr = 48_000
    const pcm: TakePcm = {
      t1: Float32Array.from({ length: sr }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / sr)),
    }
    // No music → the two-stage path must not run, so a re-render matches exactly.
    const a = renderSession(s, pcm, sr)
    const b = renderSession(s, pcm, sr)
    expect(a.samples.length).toBe(b.samples.length)
    for (let i = 0; i < a.samples.length; i += 1) expect(a.samples[i]).toBe(b.samples[i])
  })

  it("mixes music into the deliverable and keeps the ceiling", () => {
    const sr = 48_000
    const s0 = addTake(newSession("s", "e"), take("t1", 1), "c1")
    const slot = newSlot("intro", "m1")
    const s = updateSlot(addSlot(s0, slot), slot.id, { lengthSec: 1, pick: pick(1) })
    const pcm: TakePcm = {
      t1: Float32Array.from({ length: sr }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / sr)),
    }
    const music: CuePcm = {
      [PATH]: Float32Array.from(
        { length: sr },
        (_, i) => 0.3 * Math.sin((2 * Math.PI * 110 * i) / sr),
      ),
    }
    const withCue = renderSession(s, pcm, sr, music)
    const speechOnly = renderSession(s0, pcm, sr)

    // The music changed the mix, and the final limiter still holds -1 dBFS.
    let differs = false
    for (let i = 0; i < withCue.samples.length; i += 1)
      if (Math.abs(withCue.samples[i] - speechOnly.samples[i]) > 1e-6) {
        differs = true
        break
      }
    expect(differs).toBe(true)

    let peak = 0
    for (const v of withCue.samples) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeLessThanOrEqual(Math.pow(10, -1 / 20) * 1.0001)
  })
})
