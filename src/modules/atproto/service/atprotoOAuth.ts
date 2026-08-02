import { BrowserOAuthClient, buildLoopbackClientId } from "@atproto/oauth-client-browser"

// Mirrored path-for-path from remanso.space. The only line that differs is the
// production client_id below: `client_id` *is* the client-metadata URL, so
// https://remanso.at/client-metadata.json is a distinct OAuth client from
// remanso.space's. Sessions cannot be shared across the two origins — different
// consent, refresh token and DPoP-bound keypair. Two sign-ins is the design.
const getClientId = () =>
  import.meta.env.DEV
    ? buildLoopbackClientId(new URL(window.location.origin))
    : "https://remanso.at/client-metadata.json"

let clientPromise: Promise<BrowserOAuthClient> | null = null

export const getOAuthClient = (): Promise<BrowserOAuthClient> => {
  if (!clientPromise) {
    clientPromise = BrowserOAuthClient.load({
      clientId: getClientId(),
      handleResolver: "https://bsky.social",
    })
  }
  return clientPromise
}

export const signInWithHandle = async (handle: string): Promise<void> => {
  const client = await getOAuthClient()
  await client.signInRedirect(handle)
}

export const restoreSession = async () => {
  const client = await getOAuthClient()
  const result = await client.init()
  return result?.session ?? null
}

export const sdkSignOut = async (sub: string): Promise<void> => {
  const client = await getOAuthClient()
  await client.revoke(sub)
}

/**
 * Re-derive the live OAuth session for a DID. `init()` hands the session back
 * only once, on the redirect that created it, so anything needing to write to
 * the PDS later restores it from storage by DID instead.
 */
export const getActiveSession = async (did: string) => {
  try {
    const client = await getOAuthClient()
    return await client.restore(did)
  } catch (error) {
    console.warn("getActiveSession: could not restore session", error)
    return null
  }
}
