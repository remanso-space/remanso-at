export interface History<T> {
  present: T
  past: T[]
}

/** Snapshots are small, so this is a memory guard rather than a policy on how far undo goes. */
export const HISTORY_LIMIT = 100

export const historyOf = <T>(present: T): History<T> => ({ present, past: [] })

/**
 * An edit that changed nothing (the same object back) records no undo step, so rejecting an
 * empty region does not leave the user pressing undo against a stack of no-ops.
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
