# Slice 2 — ATProto sign-in

## Plan

- [ ] Confirm slice-1 committed (done: 94f30a8) + nginx client-metadata block intact (verified)
- [ ] Add deps: `@atproto/oauth-client-browser@^0.3.41`, `vue-router@^4.5.1`
- [ ] Mirror `src/modules/atproto/service/atprotoOAuth.ts` (one string: client_id → remanso.at)
- [ ] `src/modules/atproto/service/atprotoSession.ts` — localStorage, not PouchDB
- [ ] `src/composables/useSession.ts` — auth state + `?handle=` prefill then router.replace strip
- [ ] Copy lexicon JSONs → `lexicons/space/remanso/{note,recording}.json`
- [ ] Hand-write types: `publicNote.types.ts` (fontSize:number, theme, discoverable, language), `recording.types.ts`
- [ ] Install vue-router: `src/router.ts`, wire in `main.ts`
- [ ] Split `App.vue` → shell (nav + router-view + footer) ; `views/HomeView.vue` (the ode body)
- [ ] `views/StudioView.vue` — signed-out pitch, not a redirect ; `views/ListenView.vue` — placeholder
- [ ] `components/SignIn.vue` in nav
- [ ] Promote nav anchors + room cards to real route links
- [ ] Cross-link from remanso.space nav carrying `?handle=`
- [ ] Gates: pnpm build (zero warnings) + lint + fmt:check
- [ ] README macroplan: mark "ATProto sign-in" delivered ; write docs/handover/slice-2-*.md
- [ ] Push (Gitea+GitHub), verify live

## Review (done 2026-08-03)

- All items complete. `pnpm build` (zero warnings), `pnpm lint`, `pnpm fmt:check` clean.
- remanso.space cross-link added (`WelcomeWorld.vue` nav `Studio ↗` with `?handle=`); its lint + typecheck clean.
- `core-js` build-script decision recorded in `pnpm-workspace.yaml` (false) so Docker `--frozen-lockfile` won't fail.
- Main JS chunk ~421 kB from eager `BrowserOAuthClient` — noted in handover, code-split later if needed.

## Guardrails

- font @import stays line 1 of style.css, above `@import "tailwindcss"`
- tailwind scan pinned source(none)+@source ; anything outside src/**/*.{vue,ts} needs its own @source
- #ffa4c0 chrome byte-identical ; --hw-pink #e36598 editorial accent
- no /ambient ; do not touch remanso-jetstream
- sessions NOT shared with remanso.space (different origin/client) — two sign-ins by design
