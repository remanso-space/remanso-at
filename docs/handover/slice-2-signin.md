# Slice 2 — ATProto sign-in

Done 2026-08-03, deployed and verified live. Read slice 0's and slice 1's handovers plus the plan
doc for the decisions; this file covers only what slice 2 changed and what slice 4 needs to keep
going.

Plan doc: `/home/jean/.claude/plans/looking-at-the-remanso-whimsical-island.md`.
Slice 0: `docs/handover/slice-0-deploy.md`. Slice 1: `docs/handover/slice-1-landing.md`.

## What shipped

You can sign in on https://remanso.at with an atproto handle, and the landing page's two sold rooms
are now real routes. Still no audio — that is slice 4.

- **OAuth** via `@atproto/oauth-client-browser`. `src/modules/atproto/service/atprotoOAuth.ts` is
  mirrored path-for-path from remanso.space; the only line that differs is the production
  `client_id`, now `https://remanso.at/client-metadata.json`. The metadata itself shipped in slice 1
  and is unchanged. The consent screen reads **Remanso Studio**.
- **`vue-router` is installed** — this slice was the first real route need. `src/router.ts` has
  `/`, `/studio`, `/listen`, and a catch-all that redirects to `/`. `App.vue` became a shell (nav +
  `<RouterView>` + footer); the landing body moved to `src/views/HomeView.vue` verbatim. The nav
  anchors and the two room cards are now `RouterLink`s, not in-page `#studio`/`#listen` anchors.
- **Deep links stay anonymous.** No navigation guards. `/studio` renders a signed-out pitch
  (`StudioView.vue`) rather than redirecting; `/listen` is a placeholder (`ListenView.vue`) until
  the appview indexes recordings (slice 7).
- **Session** lives in one `localStorage` key (`atproto-session-current`), not PouchDB —
  `src/modules/atproto/service/atprotoSession.ts`. It is only a fast local hint of who was signed
  in; the real grant (tokens + DPoP key) is in origin-scoped IndexedDB, owned by
  `BrowserOAuthClient`. `src/composables/useSession.ts` is the auth state, adapted from
  remanso.space's `useATProtoLogin.hook.ts`.
- **`?handle=` cross-link.** remanso.space's `WelcomeWorld.vue` nav gained a `Studio ↗` link
  carrying `?handle=<handle>` when signed in. On the remanso.at side, `useSession` pre-fills the
  sign-in input from that param, `router.replace`s it away so it is not bookmarked, then starts
  `signInRedirect`. Sessions are **not** shared across the origins — different `client_id`,
  DPoP-bound keys — so this hand-off is the cheapest it gets: one hop instead of retyping the handle.
- **Lexicons + types.** `lexicons/space/remanso/{note,recording}.json` copied byte-identical from
  `remanso-jetstream`; `src/modules/atproto/publicNote.types.ts` and `recording.types.ts`
  hand-written from them. The known `fontSize` drift is corrected here (`number`, per the lexicon's
  `integer`; remanso.space still says `string`). These types have no consumer yet — slice 4 (the
  my-published-notes list) is the first.

## Verified, not assumed

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://remanso.at/                              # 200
curl -s -o /dev/null -w '%{content_type}\n' https://remanso.at/client-metadata.json       # application/json — survived
curl -s https://remanso.at/client-metadata.json | grep -o 'remanso.at/client-metadata.json'  # client_id is its own URL
curl -s -o /dev/null -w '%{http_code}\n' https://remanso.at/studio                        # 200 (SPA fallback, not 404)
curl -s https://remanso.at/ | grep -o 'index-[A-Za-z0-9_-]*\.js'                          # new hash, not slice 1's
```

Sign-in was exercised in the browser: consent screen says **Remanso Studio**, the callback lands on
`https://remanso.at/` with the OAuth params stripped, and remanso.space's own session is untouched
(separate IndexedDB, separate client).

`pnpm build` (zero warnings — the font `@import` is still line 1, above `@import "tailwindcss"`),
`pnpm lint`, `pnpm fmt:check` all clean before the push. remanso.space's `pnpm lint` and typecheck
are also clean after the cross-link edit.

## Gotchas / notes

- **The main JS chunk jumped to ~421 kB** (from slice 1's small bundle). That is
  `BrowserOAuthClient`, eagerly imported because the nav sign-in is on every page. remanso.space
  does the same. If it starts to hurt, lazy-load the OAuth client behind the sign-in action; it was
  not worth the indirection to ship. Not markdown-scan inflation — the CSS is still ~54 kB and
  byte-identical everywhere.
- **`core-js` needed a build-script decision.** It arrives transitively under
  `@atproto/oauth-client-browser`. Its postinstall is a funding notice, not a native compile, so it
  is set `false` in `pnpm-workspace.yaml` next to `sharp`. Without the explicit entry, Docker's
  `--frozen-lockfile` install fails with `ERR_PNPM_IGNORED_BUILDS` — the same class of failure slice
  0 hit with `sharp`.
- **Handle + avatar come from `app.bsky.actor.getProfile`** (one public call), so remanso.space's
  `getAuthor` and its `@better-fetch` + `arktype` deps stayed out. When slice 7 needs richer author
  data, revisit the plan's "rewrite `getAuthor` as ~30 lines of plain `fetch`" note.
- **`useSession(router)` is initialised once, in `App.vue` setup.** The first call with a router
  wins and kicks off OAuth restore + `?handle=` handling; later calls (e.g. from `SignIn.vue`) just
  read the shared refs. `did` is `null` until resolved (renders a skeleton), then `""` or the DID.

## Where slice 4 starts

Slice 4 is the **studio: capture → link** (slice 3 was cut). The first end-to-end slice:
my-published-notes list → one take → flag-while-recording → trim + remove-pauses → HPF + normalize
−16 + limiter → Opus → `space.remanso.recording` → a copyable `![…](at://…)` markdown link.

Groundwork now in place:

- Sign-in works, so `getActiveSession(did)` in `atprotoOAuth.ts` can restore the live session to
  `uploadBlob` / `createRecord` against the PDS.
- `recording.types.ts` + `RECORDING_COLLECTION` + `MAX_RECORDING_BYTES` are ready to mirror
  `uploadRecording.ts` / `resolveRecording.ts` against (path-for-path from remanso.space, per the
  plan's mirror list).
- The my-published-notes list reads
  `com.atproto.repo.listRecords?repo=<did>&collection=space.remanso.note` — `publicNote.types.ts` is
  the shape it returns. Mark which notes already have audio by scanning `content` for
  `at://…/space.remanso.recording/`.
- New machinery slice 4 introduces: OPFS chunk streaming, the windowed multi-track Worker renderer,
  the EDL. See the plan's studio-architecture section.

## Guardrails carried forward

- The font `@import` stays the literal first line of `src/style.css`; below `@import "tailwindcss"`
  the build silently drops it.
- Tailwind's scan is pinned with `source(none)` + explicit `@source` lines scoped to
  `src/**/*.{vue,ts}` and `index.html`. All new slice-2 files live under `src/`, so no new `@source`
  was needed; anything added outside `src/` needs its own line.
- `#ffa4c0` chrome and the icons stay byte-identical to remanso.space; `--hw-pink` `#e36598` is the
  separate editorial accent.
- No `/ambient` route — ambient is a studio cue, not a page.
- **Sessions cannot be shared with remanso.space.** Different origin, `client_id`, DPoP keys. Two
  sign-ins is the design; the `?handle=` hand-off is the mitigation, not a shared session.
- **Do not touch `remanso-jetstream`.** The lexicon JSONs were copied out of it read-only; a
  separate session owns the recording-index work.
