// Reading someone's recordings needs two things the OAuth session cannot give us: the
// PDS that holds the repo, and — for a handle in the URL — the DID behind it. Both are
// public lookups, which is what makes /listen readable while signed out.

const PLC_DIRECTORY = "https://plc.directory"
const PUBLIC_API = "https://public.api.bsky.app"

interface DidService {
  id: string
  type: string
  serviceEndpoint: string
}

export interface DidDoc {
  id: string
  service?: DidService[]
  alsoKnownAs?: string[]
}

/** `did:web:example.com:some:path` → `https://example.com/some/path/did.json`. */
const didWebUrl = (did: string): string => {
  const [, , ...parts] = did.split(":")
  const host = decodeURIComponent(parts[0])
  const path = parts.slice(1).map(decodeURIComponent)
  return path.length
    ? `https://${host}/${path.join("/")}/did.json`
    : `https://${host}/.well-known/did.json`
}

export const fetchDidDoc = async (did: string): Promise<DidDoc | null> => {
  const url = did.startsWith("did:web:") ? didWebUrl(did) : `${PLC_DIRECTORY}/${did}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as DidDoc
  } catch {
    return null
  }
}

/**
 * The repo's PDS. The service id is `#atproto_pds` relative to the DID, so a doc may
 * write it either bare or fully qualified — both forms are matched.
 */
export const pdsEndpoint = (doc: DidDoc | null): string | null => {
  const service = doc?.service?.find(
    (s) => s.id === "#atproto_pds" || s.id.endsWith("#atproto_pds"),
  )
  return service?.serviceEndpoint?.replace(/\/$/, "") ?? null
}

/** The first handle the DID document claims, without its `at://` prefix. */
export const docHandle = (doc: DidDoc | null): string | null => {
  const aka = doc?.alsoKnownAs?.find((entry) => entry.startsWith("at://"))
  return aka ? aka.slice("at://".length) : null
}

/**
 * The HTTPS half of handle resolution: `https://<handle>/.well-known/atproto-did` serves
 * the bare DID. A handle verifies by DNS TXT *or* this well-known, so a host that skips the
 * DNS record (and is thus invisible to bsky's resolver) still resolves here.
 */
const resolveHandleWellKnown = async (handle: string): Promise<string | null> => {
  try {
    const res = await fetch(`https://${handle}/.well-known/atproto-did`)
    if (!res.ok) return null
    const did = (await res.text()).trim()
    return did.startsWith("did:") ? did : null
  } catch {
    return null
  }
}

export const resolveHandle = async (handle: string): Promise<string | null> => {
  try {
    const res = await fetch(
      `${PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
    )
    if (res.ok) {
      const body = (await res.json()) as { did?: string }
      if (body.did) return body.did
    }
  } catch {
    // fall through to the well-known lookup
  }
  return resolveHandleWellKnown(handle)
}

export interface ResolvedActor {
  did: string
  pds: string
  handle: string | null
}

const resolveActorUncached = async (trimmed: string): Promise<ResolvedActor | null> => {
  const did = trimmed.startsWith("did:") ? trimmed : await resolveHandle(trimmed)
  if (!did) return null

  const doc = await fetchDidDoc(did)
  const pds = pdsEndpoint(doc)
  if (!pds) return null

  return { did, pds, handle: docHandle(doc) ?? (trimmed === did ? null : trimmed) }
}

// One repo resolution can fan out across every recording it holds — the everyone feed
// resolves each row's DID, and dozens land on the same one at once. Caching the in-flight
// promise (not just the settled value) collapses that whole burst into a single lookup,
// where a value-only cache would still let the concurrent misses each hit the network.
const actorCache = new Map<string, Promise<ResolvedActor | null>>()

/**
 * A DID or a handle in, the repo's location out. Returns null when the identity does not
 * resolve or its document names no PDS — either way there is no repo to read. Resolutions
 * are memoised per identifier for the session; a null result is not kept, so a transient
 * failure (a handle mid-propagation, a flaky network) is retried on the next call.
 */
export const resolveActor = (actor: string): Promise<ResolvedActor | null> => {
  const trimmed = actor.trim().replace(/^@/, "")
  if (!trimmed) return Promise.resolve(null)

  const cached = actorCache.get(trimmed)
  if (cached) return cached

  const pending = resolveActorUncached(trimmed)
  actorCache.set(trimmed, pending)
  pending.then(
    (resolved) => resolved || actorCache.delete(trimmed),
    () => actorCache.delete(trimmed),
  )
  return pending
}

/** Test seam: drop memoised resolutions so one test's mock cannot shadow the next's. */
export const __resetActorCache = () => actorCache.clear()

/** The public, unauthenticated URL a blob is served from. */
export const blobUrl = ({ pds, did, cid }: { pds: string; did: string; cid: string }): string => {
  const url = new URL("/xrpc/com.atproto.sync.getBlob", pds)
  url.searchParams.set("did", did)
  url.searchParams.set("cid", cid)
  return url.toString()
}
