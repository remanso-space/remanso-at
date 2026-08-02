# Slice 0 — domain handover and first deploy

Done 2026-08-02. Read this plus the plan doc and you have everything needed for slice 1.

Plan doc: `/home/jean/.claude/plans/looking-at-the-remanso-whimsical-island.md`. It holds the
decisions, the mirror/fork/refuse file lists, the studio and ambient designs, and the RSS findings.
This file only covers what slice 0 actually did and what a fresh session needs to keep going.

## What shipped

A Vue 3 SPA on the apoena house stack, deployed at https://remanso.at, showing a holding page that
names the two routes to come. No auth, no audio, no router yet.

Scope corrected 2026-08-02, after the holding page shipped: **there is no `/ambient` page.** Ambient
sound is a studio feature — beds mixed into the render, alongside spot music and sound effects. And
`/listen` browses `space.remanso.recording`, not notes; notes stay on remanso.space and a link to one
navigates there. The public tier of that browser is blocked on `remanso-jetstream` indexing
recordings, which it does not do today.

|                          |                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------- |
| Live                     | https://remanso.at (www 301s to apex)                                            |
| Gitea                    | https://git.apoena.dev/remanso-space/remanso-at                                  |
| GitHub mirror            | https://github.com/remanso-space/remanso-at                                      |
| Coolify app              | `pdwaatkwhp1fqthcmq2crrv3`                                                       |
| Coolify project / server | `o4w3ghkux3zo3wm8gsxri5lg` / `adnwww057yrh5a1b1nfo5o26`                          |
| Gitea webhook            | id 35, push events, to `platform.apoena.dev/webhooks/source/gitea/events/manual` |

Versions installed: vite 8.2.0, vue 3.5.40, tailwindcss 4.3.3 (`@tailwindcss/vite`, no config
file), daisyui 5.7.9, typescript ~6.0.2, vue-tsc 3.3.8, vite-plugin-pwa 1.3.0, oxlint 1.76,
oxfmt 0.61, pnpm 11.17.0 (pinned via `packageManager`).

### Identity is shared with remanso.space, deliberately

One brand, one mark, one colour. The icon set is **copied verbatim** rather than regenerated, and
`favicon.ico`, `masked-icon.png` and `pwa-512x512.png` were confirmed byte-identical to what
remanso.space serves. `manifest.webmanifest` matches on `name`, `short_name`, `theme_color`
(`#ffa4c0`), `background_color` and all five icons. `#ffa4c0` is also the `mask-icon` colour,
`theme-color`, and DaisyUI's `--color-primary`.

**Two pinks, on purpose, mirroring remanso.space:** `#ffa4c0` is the chrome colour, while
`--hw-pink` `#e36598` stays the darker editorial accent its `WelcomeWorld.vue` uses for prose and
rules. That is not an inconsistency to tidy up.

To change any icon, change it in remanso.space and copy the files across —
`@vite-pwa/assets-generator` is deliberately not used here (see the gotchas).

`registerType: "prompt"` needs UI to actually apply updates, so `src/components/NewVersion.vue`
renders the toast. **When the studio lands, suppress that toast while a take is recording** — an
update dialog mid-recording is hostile.

`client_name` in `client-metadata.json` is still `"Remanso Studio"`, not `"Remanso"`. That string is
what a PDS consent screen and the user's revocation list display, and it is the one place where
identical naming has a real cost: two clients both called "Remanso" cannot be told apart when
revoking one. Say the word if you want it unified anyway.

`origin` has one fetch URL (Gitea) and two push URLs, so a single `git push` writes both remotes.

## Verified, not assumed

Each of these was checked against the live site after deploy:

```bash
curl -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://remanso.at/          # 200 0
curl -o /dev/null -w '%{http_code} -> %{redirect_url}\n'   https://www.remanso.at/      # 301 -> apex
curl -o /dev/null -w '%{http_code}\n'                      https://remanso.at/listen    # 200, not 404
curl -o /dev/null -w '%{content_type}\n'  https://remanso.at/client-metadata.json       # application/json
```

- `/listen` returning 200 proves both the SPA `try_files` fallback and that `nginx.conf` was
  actually `COPY`d into the image.
- `www` returning a **valid** cert (`ssl_verify_result=0`) is the fix for what was previously a
  self-signed cert. Both domains had to be in the app's `domains` at create time.
- The font `@import` is the first rule of the built CSS, so the Coollabs fonts really load. Both
  families were confirmed to return real `@font-face` rules from `api.fonts.coollabs.io` before
  being wired in.
- `pnpm build`, `pnpm lint`, `pnpm fmt:check` are all clean with no warnings.

## Gotchas hit, so you don't rediscover them

- **The Coolify git-URL truncation is real.** `POST /applications/public` stored
  `git_repository` as `remanso-space/remanso-at`, which fails at clone. It was PATCHed to
  `https://git.apoena.dev/remanso-space/remanso-at.git` and read back to confirm. Any future app
  needs the same two-step.
- **`packageManager` must be pinned in `package.json`.** The Dockerfile runs `corepack enable`,
  and without the pin corepack picks its own pnpm, which can reject the committed lockfile.
- **`pnpm dev` does not land on 5173 here.** Other projects hold 5173-5179; this one came up on 5180. Read the port out of the dev server output instead of assuming, or you will test another
  app and misread the result.
- **The Docker daemon is not running on this machine**, so the image could not be built locally.
  The Coolify build log is the only feedback loop for Dockerfile changes.
- `set -a; source ~/.config/apoena/coolify.env; set +a` — plain `source` leaves the UUIDs
  unexported, and anything reading `os.environ` then fails.
- **`vite-plugin-pwa` drags in `sharp`, and pnpm 11 blocks the install until you decide about it.**
  `@vite-pwa/assets-generator` is an optional peer that pnpm installs automatically, and it depends
  on `sharp`. pnpm writes a `pnpm-workspace.yaml` stub reading `sharp: set this to true or false`
  and fails with `ERR_PNPM_IGNORED_BUILDS` until it is resolved. It is set to `false` here, since
  nothing runs the generator. **The Dockerfile must `COPY pnpm-workspace.yaml`** or the decision is
  invisible inside the build and the install fails there while succeeding locally — deploy
  `db7644f` failed exactly this way.
- **`virtual:pwa-register/vue` needs `workbox-window` installed explicitly.** Without it the build
  dies at `Rolldown failed to resolve import "workbox-window"`.
- **nginx has no mime type for `.webmanifest`**, so the manifest was served as
  `application/octet-stream`, which some browsers reject when judging installability. There is now
  an explicit `location = /manifest.webmanifest` block, matching the one for
  `client-metadata.json`.
- **Missing paths return 200, not 404**, because of the SPA `try_files` fallback. `/favicon.png`
  returning 200 does not mean the file exists — check `content_type`; the fallback answers
  `text/html`.
- **Tailwind v4's automatic source scan reads markdown, so docs were changing the CSS output.**
  A local build produced 20768 bytes of CSS against production's 18000, because `.dockerignore`
  strips markdown from the image but not from the working tree, and class names quoted in
  README/docs prose were generating real rules. Fixed in `src/style.css` with
  `@import "tailwindcss" source(none)` plus explicit `@source` lines scoped to `src/**/*.{vue,ts}`
  and `index.html`; output dropped to 15847 bytes and is now identical everywhere. If you add a
  directory of components outside `src/`, add an `@source` line for it or its classes silently
  will not compile.

## Where slice 1 starts

Slice 1 is **the ode**: turn the holding page into the real editorial landing page.

Current state to build on:

- `src/App.vue` — the holding page. Replace it; the route list in it is a placeholder.
- `src/style.css` — the `--hw-*` token layer is already in place (pink `#e36598`, leaf `#6b8e4e`,
  Libertinus Serif + Courier Prime, 2px radii, `--link-accent` for contrast-safe link colour, and
  a `.hw-label` class for `§ 01 —` mono section labels). DaisyUI's `light` theme is overridden so
  the palette reaches components as well as utilities. **Do not move the font `@import` off line 5.**
- `src/components/NewVersion.vue` — the service-worker update toast.
- `src/assets/icons/` — drop further Tabler outline SVGs here; see its README for the two usage
  patterns.

Reference for the voice and typography: `WelcomeWorld.vue` in
`/home/jean/projects/remanso/src/components/`. It is 2266 lines and does double duty as a logged-in
launchpad and a marketing page. Lift the editorial idioms (drop caps, `§ 01 —` labels, 1px ink
borders, the two faint radial washes) and write fresh markup. Do not copy the launchpad half, and
do not copy `useMarkdown.hook.ts` or anything it pulls in.

No router is installed yet. Slice 1 can stay single-page; add `vue-router` when `/listen` and
`/studio` actually need routes.

The route list in `src/App.vue` is `/studio` and `/listen` only. Do not reintroduce `/ambient`.

## Guardrails carried forward

- **The studio must never `putRecord` a note.** `*.pub.md` in git is the source of truth and
  `remanso-cli` tracks it by `contentHash` + `noteHash`. The studio publishes a
  `space.remanso.recording` and hands over a markdown link; that is the whole contract.
- **Sessions cannot be shared with remanso.space.** Different origin, different `client_id`,
  DPoP keys bound to a non-extractable `CryptoKey`. Two sign-ins is the design, not a bug to fix.
- `redirect_uris` is apex-only on purpose. `www.remanso.at` is a different origin, which is why
  nginx 301s it.
- No RSS. If it ever returns, the blob proxy must be off-box: everything in this ecosystem shares
  `51.77.135.129`, and podcast bursts would starve the firehose listener.

## Still open

- **Rotate the Gitea PAT.** It was exposed in cleartext in the session transcript that produced
  slice 0. https://git.apoena.dev/user/settings/applications, then update
  `~/.dotfiles/zsh/private.zsh`.
- **The macroplan block has not been pasted into the app.** The Chrome extension was not connected,
  so browser automation was unavailable. Either paste the block from `README.md` into the editor at
  https://macroplan.apoena.dev, or run this in DevTools on that origin and reload:
  `localStorage.setItem('macroplan:source', <the toml string>)` — the app migrates
  `macroplan:source` into a plan in `macroplan:library`, whose shape is
  `{version:1, activeId, plans:[{id, name, source}]}`.

Nothing else. The push-to-deploy loop is verified: commit `6bbff99` triggered a deployment through
the Gitea webhook with no manual step, and it reached `finished`.
