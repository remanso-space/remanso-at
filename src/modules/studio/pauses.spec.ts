import { describe, expect, it } from "vitest"

import {
  detectSilences,
  keptRegions,
  planCuts,
  rmsEnvelopeDb,
  speechOnsets,
  type Silence,
} from "./pauses"

const SR = 48_000

/** A run of `sec` seconds at constant linear amplitude `level` (RMS == level). */
const seg = (sec: number, level: number): Float32Array => {
  const buf = new Float32Array(Math.round(sec * SR))
  buf.fill(level)
  return buf
}

const concat = (...parts: Float32Array[]): Float32Array => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Float32Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const SPEECH = 0.3 // ~ -10.5 dBFS
const QUIET = 0 // silence

describe("rmsEnvelopeDb", () => {
  it("reads a constant level as its dBFS and silence as the floor", () => {
    const env = rmsEnvelopeDb(concat(seg(0.1, 0.5), seg(0.1, QUIET)), SR, 0.02)

    expect(env.slice(0, 4).every((db) => Math.abs(db - -6.02) < 0.1)).toBe(true)
    expect(env.slice(-4).every((db) => db <= -100)).toBe(true)
  })

  it("returns nothing for an empty buffer", () => {
    expect(rmsEnvelopeDb(new Float32Array(0), SR, 0.02)).toEqual([])
  })
})

describe("detectSilences", () => {
  it("finds a clear interior pause and does not flag it as an edge", () => {
    const buf = concat(seg(1, SPEECH), seg(1, QUIET), seg(1, SPEECH))
    const silences = detectSilences(buf, SR)

    expect(silences).toHaveLength(1)
    expect(silences[0].edge).toBe(false)
    expect(silences[0].startSec).toBeCloseTo(1, 1)
    expect(silences[0].endSec).toBeCloseTo(2, 1)
  })

  it("flags leading and trailing silence as edges", () => {
    const buf = concat(seg(0.6, QUIET), seg(1, SPEECH), seg(0.6, QUIET))
    const silences = detectSilences(buf, SR)

    expect(silences).toHaveLength(2)
    expect(silences[0]).toMatchObject({ edge: true })
    expect(silences[0].startSec).toBeCloseTo(0, 2)
    expect(silences[1].edge).toBe(true)
    expect(silences[1].endSec).toBeCloseTo(2.2, 1)
  })

  it("holds through a dip that stays inside the hysteresis band", () => {
    // Real silence at the tail pins the floor to -100; the interior 0.1 s dip sits at
    // -90 dB — below speechThresh (-86) but above silenceThresh (-94) — so mid-speech it
    // must not open a pause. Only the tail silence should be reported.
    const between = Math.pow(10, -90 / 20) // -90 dBFS, inside the [-94, -86] band
    const buf = concat(seg(0.5, SPEECH), seg(0.1, between), seg(0.5, SPEECH), seg(0.5, QUIET))
    const silences = detectSilences(buf, SR)

    expect(silences).toHaveLength(1)
    expect(silences[0].edge).toBe(true)
    expect(silences[0].startSec).toBeCloseTo(1.1, 1)
  })

  it("proposes nothing for a take with no confident silence (all one level)", () => {
    // A take that is silent throughout (or all one level) has too little dynamic range
    // to seat the thresholds below speech, so the detector declines rather than cut.
    expect(detectSilences(seg(2, QUIET), SR)).toEqual([])
    expect(detectSilences(seg(2, SPEECH), SR)).toEqual([])
  })
})

describe("planCuts", () => {
  const interior = (startSec: number, endSec: number): Silence => ({
    startSec,
    endSec,
    edge: false,
  })
  const edge = (startSec: number, endSec: number): Silence => ({ startSec, endSec, edge: true })

  it("shortens a long interior pause to the target gap by removing its tail", () => {
    const cuts = planCuts([interior(10, 11)]) // 1.0 s pause, target 0.35

    expect(cuts).toEqual([{ startSec: 10.35, endSec: 11 }])
  })

  it("leaves a pause shorter than minPauseSec alone", () => {
    expect(planCuts([interior(10, 10.4)])).toEqual([])
  })

  it("removes head and tail silence in full", () => {
    const cuts = planCuts([edge(0, 2), edge(58, 60)])

    expect(cuts).toEqual([
      { startSec: 0, endSec: 2 },
      { startSec: 58, endSec: 60 },
    ])
  })

  it("drops a zero-length edge silence", () => {
    expect(planCuts([edge(5, 5)])).toEqual([])
  })

  it("keeps the spans between cuts (the complement)", () => {
    expect(keptRegions(10, [{ startSec: 2, endSec: 4 }])).toEqual([
      { inSec: 0, outSec: 2 },
      { inSec: 4, outSec: 10 },
    ])
  })

  it("drops a head cut so the first kept region starts after it", () => {
    expect(keptRegions(10, [{ startSec: 0, endSec: 3 }])).toEqual([{ inSec: 3, outSec: 10 }])
  })

  it("merges overlapping cuts before taking the complement", () => {
    expect(
      keptRegions(10, [
        { startSec: 6, endSec: 8 },
        { startSec: 2, endSec: 5 },
        { startSec: 4, endSec: 7 },
      ]),
    ).toEqual([
      { inSec: 0, outSec: 2 },
      { inSec: 8, outSec: 10 },
    ])
  })

  it("returns the whole take when there are no cuts", () => {
    expect(keptRegions(10, [])).toEqual([{ inSec: 0, outSec: 10 }])
  })

  it("processes a whole take: head cut, interior shortened, tail cut", () => {
    const buf = concat(
      seg(1, QUIET),
      seg(1, SPEECH),
      seg(1.2, QUIET),
      seg(1, SPEECH),
      seg(1, QUIET),
    )
    const cuts = planCuts(detectSilences(buf, SR))

    expect(cuts).toHaveLength(3)
    // head removed fully
    expect(cuts[0].startSec).toBeCloseTo(0, 2)
    expect(cuts[0].endSec).toBeCloseTo(1, 1)
    // interior 1.2 s shortened: keep 0.35 after speech ends (~2.0), remove to ~3.2
    expect(cuts[1].startSec).toBeCloseTo(2.35, 1)
    expect(cuts[1].endSec).toBeCloseTo(3.2, 1)
    // tail removed fully
    expect(cuts[2].endSec).toBeCloseTo(5.2, 1)
  })
})

describe("speechOnsets", () => {
  it("marks zero when the take opens on a voice", () => {
    const onsets = speechOnsets(concat(seg(1, SPEECH), seg(1, QUIET), seg(1, SPEECH)), SR)

    expect(onsets[0]).toBe(0)
    expect(onsets[1]).toBeCloseTo(2, 1)
  })

  it("does not mark zero when the take opens on silence", () => {
    const onsets = speechOnsets(concat(seg(1, QUIET), seg(1, SPEECH)), SR)

    expect(onsets).toHaveLength(1)
    expect(onsets[0]).toBeCloseTo(1, 1)
  })

  it("ignores the trailing silence, which never resumes", () => {
    const onsets = speechOnsets(concat(seg(1, SPEECH), seg(1, QUIET)), SR)

    expect(onsets).toEqual([0])
  })

  it("returns nothing for an empty take", () => {
    expect(speechOnsets(new Float32Array(0), SR)).toEqual([])
  })
})
