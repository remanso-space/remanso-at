import { describe, expect, it } from "vitest"

import { canUndo, commit, historyOf, undo } from "./history"

describe("history", () => {
  it("starts with nothing to undo", () => {
    const h = historyOf({ n: 0 })

    expect(canUndo(h)).toBe(false)
    expect(undo(h)).toBe(h)
  })

  it("walks back through every committed value", () => {
    let h = historyOf({ n: 0 })
    h = commit(h, { n: 1 })
    h = commit(h, { n: 2 })

    expect(h.present).toEqual({ n: 2 })
    h = undo(h)
    expect(h.present).toEqual({ n: 1 })
    h = undo(h)
    expect(h.present).toEqual({ n: 0 })
    expect(canUndo(h)).toBe(false)
  })

  it("does not record an edit that changed nothing", () => {
    const value = { n: 0 }
    const h = commit(historyOf(value), value)

    expect(canUndo(h)).toBe(false)
  })

  it("drops the oldest snapshots past the limit", () => {
    let h = historyOf(0)
    for (let i = 1; i <= 5; i += 1) h = commit(h, i, 3)

    expect(h.past).toEqual([2, 3, 4])
  })

  it("leaves the snapshots it holds untouched", () => {
    const first = { n: 0 }
    const h = undo(commit(historyOf(first), { n: 1 }))

    expect(h.present).toBe(first)
  })
})
