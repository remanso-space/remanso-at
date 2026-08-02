import { describe, expect, it } from "vitest"

import { dbToAmplitude } from "../../utils/loudness"
import { duckEnvelope } from "./duck"

const SR = 8000

// A voice that talks, falls silent for a stretch, then talks again — the shape ducking has
// to follow.
const speechThenSilence = (): Float32Array => {
  const talk = (sec: number, amp: number) =>
    Float32Array.from({ length: Math.round(sec * SR) }, (_, i) =>
      amp === 0 ? 0 : amp * Math.sin((2 * Math.PI * 300 * i) / SR),
    )
  const out = new Float32Array(Math.round(2 * SR))
  out.set(talk(0.5, 0.5), 0)
  out.set(talk(1.0, 0), Math.round(0.5 * SR))
  out.set(talk(0.5, 0.5), Math.round(1.5 * SR))
  return out
}

describe("duckEnvelope", () => {
  it("pulls down under speech and rises back up in the gap", () => {
    const env = duckEnvelope(speechThenSilence(), SR, { depthDb: -12 })
    const floor = dbToAmplitude(-12)

    // Deep inside the first spoken stretch: near the floor.
    const underSpeech = env[Math.round(0.4 * SR)]
    expect(underSpeech).toBeLessThan(floor + 0.1)

    // Late in the one-second silence: the 0.8 s release has lifted it well clear of the
    // floor (one time constant ≈ 63%, so ~0.9 s in it is two-thirds recovered, not full).
    const inGap = env[Math.round(1.4 * SR)]
    expect(inGap).toBeGreaterThan(0.6)
    expect(inGap).toBeGreaterThan(underSpeech + 0.3)
  })

  it("never exceeds unity or drops below the floor", () => {
    const env = duckEnvelope(speechThenSilence(), SR, { depthDb: -9 })
    const floor = dbToAmplitude(-9)
    for (const v of env) {
      expect(v).toBeLessThanOrEqual(1 + 1e-6)
      expect(v).toBeGreaterThanOrEqual(floor - 1e-6)
    }
  })

  it("engages faster than it releases (300 ms attack, 800 ms release)", () => {
    const env = duckEnvelope(speechThenSilence(), SR, { depthDb: -12 })
    const floor = dbToAmplitude(-12)

    // 150 ms into the first spoken stretch the attack has already moved most of the way
    // down; 150 ms into the silence the slower release has barely lifted.
    const attackProgress = 1 - (env[Math.round(0.15 * SR)] - floor) / (1 - floor)
    const releaseProgress = (env[Math.round(0.65 * SR)] - floor) / (1 - floor)
    expect(attackProgress).toBeGreaterThan(releaseProgress)
  })

  it("returns an empty envelope for empty speech", () => {
    expect(duckEnvelope(new Float32Array(0), SR).length).toBe(0)
  })
})
