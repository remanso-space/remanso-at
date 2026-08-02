import { computed, ref } from "vue"
import type { Router } from "vue-router"

import {
  restoreSession,
  sdkSignOut,
  signInWithHandle,
} from "../modules/atproto/service/atprotoOAuth"
import { clearSession, loadSession, saveSession } from "../modules/atproto/service/atprotoSession"

// null = auth not resolved yet (render a skeleton). "" = resolved, signed out.
const did = ref<string | null>(null)
const handle = ref<string | null>(null)
const avatarUrl = ref<string | null>(null)
// Seeds the sign-in input when a remanso.space cross-link carries ?handle=.
const prefillHandle = ref("")

let started = false

// Resolve handle + avatar in one public call. remanso.space uses getAuthor for
// this (which drags in @better-fetch + arktype); getProfile returns both fields,
// so the studio needs neither dependency yet.
const fetchProfile = async (actorDid: string) => {
  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actorDid)}`,
    )
    if (!res.ok) return
    const data = await res.json()
    if (data.handle) handle.value = data.handle
    avatarUrl.value = data.avatar ?? null
  } catch {
    avatarUrl.value = null
  }
}

const stripQueryParam = (router: Router, param: string) => {
  const query = { ...router.currentRoute.value.query }
  delete query[param]
  return router.replace({ path: router.currentRoute.value.path, query })
}

const initialize = async (router: Router) => {
  // Local cache first so the UI paints immediately, before any network.
  const stored = loadSession()
  did.value = stored?.did ?? ""
  handle.value = stored?.handle ?? ""
  if (stored?.did) fetchProfile(stored.did)

  try {
    // init() consumes the ?code=&state= callback params on the redirect that
    // created the session, and hands the session back exactly once.
    const session = await restoreSession()

    if (session) {
      did.value = session.did
      await fetchProfile(session.did)
      saveSession(session.did, handle.value ?? "")
      // Drop any leftover OAuth callback params from the URL.
      await stripQueryParam(router, "code")
      return
    }

    if (stored?.did) {
      // Client resolved with no session: the stored grant is gone (revoked or
      // refresh expired). Drop the cached identity so the UI does not offer
      // PDS writes against a dead session.
      clearSession()
      did.value = ""
      handle.value = ""
      avatarUrl.value = null
    }
  } catch (error) {
    // A throw is a transport problem, not a revoked grant — keep the cached
    // identity so going offline does not read as being signed out.
    console.warn("useSession: could not restore the OAuth session", error)
  }

  // Signed out, and arrived from a remanso.space link carrying the handle:
  // pre-fill, strip the param so it is not bookmarked, then start sign-in.
  const inbound = new URLSearchParams(window.location.search).get("handle")
  if (inbound && !did.value) {
    prefillHandle.value = inbound
    await stripQueryParam(router, "handle")
    try {
      await signInWithHandle(inbound)
    } catch (error) {
      console.warn("useSession: ?handle= prefill sign-in failed", error)
    }
  }
}

export const useSession = (router?: Router) => {
  if (!started && router) {
    started = true
    initialize(router)
  }

  const isLoggedIn = computed(() => !!did.value)
  const isReady = computed(() => did.value !== null)

  const signIn = (inputHandle: string) => signInWithHandle(inputHandle)

  const signOut = async () => {
    if (did.value) await sdkSignOut(did.value)
    clearSession()
    did.value = ""
    handle.value = ""
    avatarUrl.value = null
  }

  return {
    did,
    handle,
    avatarUrl,
    prefillHandle,
    isLoggedIn,
    isReady,
    signIn,
    signOut,
  }
}
