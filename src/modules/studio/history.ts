// Undo for the derush pass. The EDL is a plain object and every edit returns a new one,
// so the whole undo stack is a list of past values — no command objects, no inverse
// operations, nothing to keep in sync with the editing functions (plan: "do not ship
// destructive derush without undo").
//
// Redo is deliberately absent: the operations are cheap to redo by hand and a redo stack
// is one more thing to invalidate on the next edit.

export interface History<T> {
  present: T
  past: T[]
}

/** How far back undo reaches. Snapshots are small; this is a memory guard, not a policy. */
export const HISTORY_LIMIT = 100

export const historyOf = <T>(present: T): History<T> => ({ present, past: [] })

/**
 * Record a new present. An edit that changed nothing (the same object back) is not worth
 * an undo step — rejecting an empty region would otherwise leave the user pressing undo
 * against a stack of no-ops.
 */
export const commit = <T>(history: History<T>, next: T, limit = HISTORY_LIMIT): History<T> => {
  if (Object.is(next, history.present)) return history
  return { present: next, past: [...history.past, history.present].slice(-limit) }
}

export const canUndo = <T>(history: History<T>): boolean => history.past.length > 0

export const undo = <T>(history: History<T>): History<T> => {
  if (history.past.length === 0) return history
  return {
    present: history.past[history.past.length - 1],
    past: history.past.slice(0, -1),
  }
}
