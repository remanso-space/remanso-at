// remanso.space persists the cached identity in PouchDB. remanso.at has no
// database, so the same three-function contract is backed by one localStorage
// key. This is only a fast, local hint for who was signed in — the OAuth grant
// itself (tokens + DPoP key) lives in origin-scoped IndexedDB, managed by
// BrowserOAuthClient; losing this cache signs nobody out.
export interface CachedSession {
  did: string
  handle: string
}

const SESSION_KEY = "atproto-session-current"

export const loadSession = (): CachedSession | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as CachedSession) : null
  } catch {
    return null
  }
}

export const saveSession = (did: string, handle: string): void => {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ did, handle }))
}

export const clearSession = (): void => {
  localStorage.removeItem(SESSION_KEY)
}
