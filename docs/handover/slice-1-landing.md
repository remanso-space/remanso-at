# Slice 1 — the ode, the landing page

Done 2026-08-02, deployed and verified live. Read slice 0's handover plus the plan doc for the
decisions; this file covers only what slice 1 changed and what slice 2 needs to keep going.

Plan doc: `/home/jean/.claude/plans/looking-at-the-remanso-whimsical-island.md`.
Slice 0: `docs/handover/slice-0-deploy.md`.

## What shipped

The placeholder holding page in `src/App.vue` is now the real editorial landing page for Remanso
Studio, live at https://remanso.at. Still a single Vue SPA, no router, no auth, no audio.

Sections, top to bottom:

- **Nav** — brand mark + word, in-page anchors `#studio` / `#listen`, and an outbound link to
  remanso.space.
- **Hero (the ode)** — "Say it out loud, and keep it where your words already live," the lede on a
  recording landing in your own PDS, and a ripple-animated transparent mark (`/mark.png`).
- **Two rooms** — cards for `/studio` and `/listen`, each describing the route and carrying an
  "in the works" tag. Neither route exists yet, so the cards do not link anywhere; the tag is the
  honest signal.
- **§ 01 manifesto** — the shared _remanso = still pool_ identity, turned toward sound, with the
  drop cap.
- **§ 02 from a take to a note** — the three-step record → cut/mix → publish-and-paste flow, ending
  on the copyable `![…](at://…)` markdown snippet the studio will hand back.
- **§ 03 sibling** — one account, two tools; links to remanso.space.
- **Footer** — mark, links (remanso.space, atproto, source), year via `new Date().getFullYear()`.

The copy was written against the `ai-writing-tropes` checklist: no negative parallelism, no
em-dash addiction (prose has none beyond the `§ 01 —` mono labels), no "quietly"/"delve", no
bold-first bullets, no stacked tricolons, no rhetorical Q&A, no grandiose stakes.

`src/style.css` gained six derived tokens in the `:root` layer — `--hw-pink-deep`, `--hw-pink-wash`,
`--hw-pink-wash-2`, `--hw-surface`, `--hw-serif`, `--hw-mono` — because the ode is the first thing
that actually uses the layer slice 0 shipped. **The font `@import` is still line 5, above
`@import "tailwindcss"`**; the build is warning-free, so the Coollabs fonts still load.

## Verified, not assumed

Checked against the live site after the Gitea-webhook deploy finished:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://remanso.at/                                 # 200
curl -s https://remanso.at/ | grep -o 'index-[A-Za-z0-9_-]*\.js'                             # index-BRNnwdL9.js (new, not remanso.space's)
curl -s https://remanso.at/assets/index-BRNnwdL9.js | grep -c 'Say it out loud'              # 1 — the new page is really live
curl -s -o /dev/null -w '%{ssl_verify_result} %{http_code}\n' https://www.remanso.at/        # 0 301  (valid cert, 301 to apex)
curl -s -o /dev/null -w '%{http_code}\n' https://remanso.at/listen                           # 200, not 404
```

`pnpm build` (zero warnings), `pnpm lint`, `pnpm fmt:check` all clean before the push.

## Gotchas / notes

- **The built CSS grew from ~16 kB to ~43 kB.** That is real scoped-component CSS from the landing
  page, not a return of slice 0's markdown-scan inflation. `@import "tailwindcss" source(none)` plus
  the explicit `@source` lines are intact, so local, CI and production stay byte-identical. Do not
  "fix" the size.
- **The in-page mark is `public/mark.png`, a transparent flower.** The shared PWA/favicon assets
  (`pwa-512x512.png`, `pwa-192x192.png`) are RGB with no alpha — a solid **white** box, which looked
  wrong sitting over the hero's pink ripple rings. `mark.png` is the pwa-512 flower with the white
  un-matted to transparency (proper edge alpha, no halo) via a stdlib-only script — no imagemagick or
  PIL on this box. Nav, hero and footer all point at it. The manifest/favicon assets keep their white
  bg on purpose (launchers want a filled icon). `src/assets/icons/README.md` still mentions a
  `RippleMark.vue` + `public/favicon.svg` that do not exist; a crisp inline SVG mark can replace the
  raster later, but was not needed to ship.
- **The two routes are sold but not wired.** `#studio` / `#listen` are in-page anchors only. When
  slice 2 installs `vue-router`, promote the room cards and nav to real route links.

## Where slice 2 starts

Slice 2 is **ATProto sign-in**. Groundwork already in place from slice 0:

- `public/client-metadata.json` is correct: `client_id` is its own URL, `client_name` is
  `Remanso Studio`, `redirect_uris` is apex-only, scope `atproto transition:generic`.
- Confirm nginx serves it as `application/json` (slice 0 added the `location` block — verify it
  survived).

The work: mirror `atprotoOAuth.ts` (one string changes, the `client_id`), add `useSession`, handle
the `?handle=` prefill-then-`router.replace`-away, copy the two lexicon JSONs and hand-write their
types, and add the first cross-link from remanso.space. **This is where `vue-router` is installed**
— the first real route need. Deep links stay anonymous; `/studio` renders a signed-out pitch, not a
redirect.

## Guardrails carried forward

- The font `@import` stays the literal first line of `src/style.css`; below `@import "tailwindcss"`
  the build silently drops it.
- Tailwind's scan is pinned with `source(none)` + explicit `@source` lines. Anything added outside
  `src/**/*.{vue,ts}` needs its own `@source` line or its classes will not compile.
- No `/ambient` route — ambient is a studio cue, not a page.
- `#ffa4c0` and the icons are byte-identical to remanso.space on purpose; `--hw-pink` `#e36598` is
  the separate darker editorial accent. Two pinks, not an inconsistency.
- **Do not touch `remanso-jetstream`.** A separate session owns the recording-index work that the
  public tier of `/listen` (slice 7) depends on.
