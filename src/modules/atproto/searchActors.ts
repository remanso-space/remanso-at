// The public Bluesky appview indexes every atproto handle and answers typeahead
// unauthenticated, which keeps the /listen handle picker usable while signed out.

const PUBLIC_API = "https://public.api.bsky.app"

/** `handle` is what /listen navigates by; the rest is only for display. */
export interface ActorSuggestion {
  did: string
  handle: string
  displayName?: string
  avatar?: string
}

interface ProfileViewBasic {
  did: string
  handle: string
  displayName?: string
  avatar?: string
}

/**
 * Never throws and never rejects: a network hiccup leaves the box behaving like a plain text
 * field rather than showing an error.
 */
export const searchActors = async (
  query: string,
  { limit = 8, signal }: { limit?: number; signal?: AbortSignal } = {},
): Promise<ActorSuggestion[]> => {
  const q = query.trim()
  if (!q) return []

  const params = new URLSearchParams({ q, limit: String(limit) })

  try {
    const res = await fetch(`${PUBLIC_API}/xrpc/app.bsky.actor.searchActorsTypeahead?${params}`, {
      signal,
    })
    if (!res.ok) return []

    const body = (await res.json()) as { actors?: ProfileViewBasic[] }
    return (body.actors ?? []).map(({ did, handle, displayName, avatar }) => ({
      did,
      handle,
      displayName,
      avatar,
    }))
  } catch {
    // Includes the abort of a superseded keystroke, which is not a failure worth surfacing.
    return []
  }
}
