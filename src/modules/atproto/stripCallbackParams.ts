import type { Router } from "vue-router"

/**
 * What `vue-atproto-login` calls to get the OAuth callback params off the URL.
 *
 * The library's default does a `history.replaceState`, which leaves `router.currentRoute`
 * describing an address the bar no longer shows; going through the router keeps the two
 * honest. Only the three params the PDS added are dropped — `?note=` and any other app param
 * survives the rewrite.
 */
export const stripCallbackParams = (router: Router) => async (url: URL) => {
  const query = Object.fromEntries(url.searchParams)
  delete query.code
  delete query.state
  delete query.iss
  await router.replace({ path: url.pathname, query })
}
