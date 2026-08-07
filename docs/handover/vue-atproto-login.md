# Sign-in moves to `vue-atproto-login`

Done 2026-08-07. Code-complete, live-pending — the browser extension was not connected, so no real
OAuth round trip has been exercised from this working copy.

Supersedes the sign-in plumbing described in `docs/handover/slice-2-signin.md`. That document still
describes the design correctly; the code it names has moved into a published package.

## What changed

`vue-atproto-login@0.3.0` (npm, MIT, `jcalixte/vue-atproto-login`) now owns the OAuth client, the
callback, the identity cache, the auth state and the sign-in UI. Four files were deleted, not
rewritten:

| Deleted                                         | Replaced by                   |
| ----------------------------------------------- | ----------------------------- |
| `src/modules/atproto/service/atprotoOAuth.ts`   | the package's `client` module |
| `src/modules/atproto/service/atprotoSession.ts` | `localStorageSession()`       |
| `src/composables/useSession.ts`                 | `useAtprotoLogin()`           |
| `src/components/SignIn.vue`                     | `<AtprotoLogin>`              |

The swap is behaviour-preserving because the package was extracted from this code:

- `getActiveSession(did)` keeps its exact signature, so `uploadRecording`, `deleteRecording` and
  `publishedNotes` changed one import line each and nothing else. Their specs now mock
  `vue-atproto-login` instead of the local service.
- The identity cache key is still `atproto-session-current`, so anyone already signed in stays
  signed in across the deploy — no forced re-consent.
- `useAtprotoLogin()` exposes `did` / `handle` / `isLoggedIn` under the same names and the same
  three-state `did` contract (`null` unresolved, `""` signed out, else the DID), which is all
  `ListenView` and `StudioView` ever destructured. `avatarUrl` is the one rename: it is `avatar`.

## Configuration

One call, in `src/main.ts`:

- `clientId: "https://remanso.at/client-metadata.json"` — unchanged, and still a distinct OAuth
  client from remanso.space's.
- `dev: import.meta.env.DEV` — passed explicitly. The library cannot read our `import.meta.env`
  (its own was frozen when it was built), and its loopback client id appends the scope, which the
  hand-rolled version did not: `putRecord` from `pnpm dev` should now be authorized rather than
  failing with an error that reads like an app bug.
- `autoSignInFromQuery: "handle"` — the remanso.space cross-link, previously inline in `useSession`.
- `stripCallbackParams` — ours, in `src/modules/atproto/stripCallbackParams.ts`, so the rewrite goes
  through `vue-router` rather than `history.replaceState` and `router.currentRoute` stays truthful.
  It drops `code` / `state` / `iss` and keeps every other param. Specced.
- `handleResolver` — **not** passed, so it takes the library default, and 0.3.0 changed that default
  from `https://bsky.social` to `https://slingshot.microcosm.blue`. That is the one behavioural
  difference from the code this replaced. It is the right default here: slingshot is an edge cache
  built for `com.atproto.identity.resolveHandle`, it returns only bi-directionally verified
  handle/DID pairs, and remanso.at is not a Bluesky client, so sign-in no longer leans on a Bluesky
  PDS to turn a typed handle into a DID. The trade is one more third party in the sign-in path:
  pass `handleResolver: "https://bsky.social"` to go back if slingshot ever becomes a liability.

## The paper skin

The library ships neutral defaults keyed off `--atp-*` custom properties. `src/style.css` re-points
those at the `--hw-*` layer, plus four rules for what no property covers: the mono handle face, and
the ink button with a pink hover (`--atp-accent` alone would paint it pink at rest).

Those four rules are three classes deep on purpose. The library's own CSS carries a scoping
attribute, so a single-class override loses on specificity no matter which stylesheet lands last.

`src/components/atprotoLoginSkin.spec.ts` asserts the class names the skin targets. A rename in a
future version of the package would otherwise drop the skin silently — the box would just go back to
Bluesky blue with every gate still green. The handle box's own key is deliberately not named there:
it is a bare daisyUI component word, and Tailwind would ship that whole component for a test file.

## Cost

- Main JS chunk 427.96 kB → 437.85 kB (+9.9 kB): the component, the typeahead and the composable,
  against the four deleted files.
- Main CSS 76.15 kB → 78.15 kB (+2.0 kB): the package stylesheet. The daisyUI component set in the
  built CSS is **byte-for-byte the same as before** — no token leaked, `atp-input` does not read as
  `input`.

## What a browser still has to confirm

1. Sign in from the nav — the typeahead is new here, `/listen` had one but the nav box did not. This
   is also the check on slingshot: a handle that resolves there but not on `bsky.social`, or the
   reverse, is the one way the 0.3.0 default shows up.
2. Refresh: identity paints from cache, then the profile resolves.
3. Sign out, then sign in again.
4. `https://remanso.at/?handle=<handle>` from remanso.space still goes straight to the PDS.
5. A publish from `/studio` — that is `getActiveSession` under the new owner.
6. An existing signed-in session survives the deploy without re-consent.

## Side fix, unrelated

`pnpm build` was already red on `main`: `vue-tsc` rejected `copyToChannel(pcm, 0)` in
`DerushPanel.vue`, because a bare `Float32Array` now means `Float32Array<ArrayBufferLike>` and the
WebAudio signature refuses a possibly-shared buffer. Narrowed at that one call with a comment rather
than widening `TakePcm`, which would have rippled through `assemble`, the render worker and their
specs for no behavioural gain.
