import { describe, expect, it } from "vitest"

import { addChapter, addTake, newSession, splitClipAt } from "./edl"
import type { Session, Take } from "./edl.types"
import { snapPoints, snapToNearest } from "./snap"

const take = (id: string, durationSec: number, flags: Take["flags"] = []): Take => ({
  id,
  opfsPath: `takes/${id}.webm`,
  durationSec,
  peaksPath: `peaks/${id}.bin`,
  flags,
  label: id,
})

const withSpeechClips = (session: Session, clips: Session["tracks"][number]["clips"]): Session => ({
  ...session,
  tracks: session.tracks.map((t) => (t.kind === "speech" ? { ...t, clips } : t)),
})

describe("snapPoints", () => {
  it("includes clip boundaries in timeline seconds", () => {
    const s = addTake(newSession("s", "e"), take("t1", 10), "c1")
    const points = snapPoints(s, {})
    const secs = points.map((p) => p.atSec)
    expect(secs).toContain(0)
    expect(secs).toContain(10)
    expect(points.every((p) => p.kind === "clip")).toBe(true)
  })

  it("projects a flag from take seconds onto the timeline", () => {
    const s = addTake(newSession("s", "e"), take("t1", 10, [{ atTakeSec: 4, kind: "mark" }]), "c1")
    const flag = snapPoints(s, {}).find((p) => p.kind === "flag")
    expect(flag?.atSec).toBe(4)
  })

  it("projects a flag through a ripple: a cut before it shifts its timeline position", () => {
    // Reject [0, 3): the tail ripples to timeline 0, so a flag at take-second 5 lands at 2.
    const s0 = addTake(newSession("s", "e"), take("t1", 10, [{ atTakeSec: 5, kind: "mark" }]), "c1")
    const [, right] = splitClipAt(s0.tracks[0].clips[0], 3, "c2")
    const s = withSpeechClips(s0, [{ ...right!, atSec: 0 }])

    const flag = snapPoints(s, {}).find((p) => p.kind === "flag")
    expect(flag?.atSec).toBe(2)
  })

  it("includes speech onsets from the analyses and a chapter mark", () => {
    let s = addTake(newSession("s", "e"), take("t1", 10), "c1")
    s = addChapter(s, { takeId: "t1", atTakeSec: 6 })
    const points = snapPoints(s, { t1: { onsets: [0, 4.5] } })

    expect(points.find((p) => p.kind === "chapter")?.atSec).toBe(6)
    expect(points.filter((p) => p.kind === "onset").map((p) => p.atSec)).toContain(4.5)
  })

  it("de-duplicates coincident targets", () => {
    // An onset at 0 coincides with the clip start at 0 — one point, not two.
    const s = addTake(newSession("s", "e"), take("t1", 10), "c1")
    const atZero = snapPoints(s, { t1: { onsets: [0] } }).filter((p) => p.atSec === 0)
    expect(atZero.length).toBe(1)
  })
})

describe("snapToNearest", () => {
  const points = snapPoints(addTake(newSession("s", "e"), take("t1", 10), "c1"), {
    t1: { onsets: [4.5] },
  })

  it("snaps to the nearest target inside the tolerance", () => {
    expect(snapToNearest(4.55, points, 0.2).atSec).toBe(4.5)
  })

  it("leaves the value alone when nothing is within tolerance (free placement)", () => {
    const r = snapToNearest(7, points, 0.2)
    expect(r.atSec).toBe(7)
    expect(r.snapped).toBeNull()
  })

  it("reports which target it snapped to", () => {
    expect(snapToNearest(0.05, points, 0.2).snapped?.kind).toBe("clip")
  })
})
