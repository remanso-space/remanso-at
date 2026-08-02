# remanso-at

**Remanso Studio** — an ode to expression and to what you keep in your PDS.

Deployed at https://remanso.at

Sibling to [remanso.space](https://remanso.space), which is the writing tool. This is the other half
of the pair: what happens to a note once it is public.

| Route     | What                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/studio` | Multi-take capture, derush, non-destructive trim, a post-production chain, and spot-placed music, sound effects or ambient beds mixed into the render. Publishes a `space.remanso.recording` and hands you the markdown link to paste into a note.     |
| `/listen` | Browse `space.remanso.recording` — yours from your PDS, everyone's from the [appview](https://api.remanso.space) once it indexes them. Notes themselves are not rendered here; links to a note open remanso.space, which stays canonical for `/pub/…`. |

## Why the studio hands you a link

Notes are authored as `*.pub.md` files in a git repo and published by
[remanso-cli](https://github.com/remanso-space/remanso-cli). The studio does not write note records:
the file in git is the source of truth, and `remanso publish` would clobber anything written
directly to the PDS.

So the studio's output is a recording plus this:

```markdown
![Episode title - audio](at://did:plc:…/space.remanso.recording/3lk…)
```

Paste it into the note, commit, and the existing GitHub Action republishes with the audio embedded.
`/studio` lists your published notes and marks which ones already have a recording, so you can see
what is still silent.

## Browsing recordings needs an appview change

`/listen` browses recordings, not notes. Two tiers, and only one of them works today:

- **Your own recordings** come from `com.atproto.repo.listRecords` against your PDS. No appview, no
  new infrastructure.
- **Everyone's recordings** need `remanso-jetstream` to ingest them. Its
  `wantedCollections` is `["space.remanso.note"]` today, so `space.remanso.recording` is never
  indexed and there is no way to discover anyone else's. That is a change in the appview repo: add
  the collection, add a `recording` table, expose `GET /recordings` and `GET /:did/recordings`.

Playback downloads the blob and plays from an object URL rather than streaming it.
`com.atproto.sync.getBlob` ignores `Range` (verified), so streaming would not let you seek — and the
waveform needs the whole buffer anyway.

## Plan

```macroplan
title = "Remanso Studio"
start = 2026-07-27
end = 2026-11-09

[[feature]]
name = "Domain handover + deploy"
start = 2026-07-27
original = 2026-07-27
delivered = 2026-07-27
learning = "Deploying an empty shell first surfaced three infra bugs before any feature code existed: Coolify truncates non-GitHub git URLs on create, pnpm's build-approval file has to be COPYd into the image, and nginx has no mime type for .webmanifest."

[[feature]]
name = "The ode — landing page"
start = 2026-08-03
original = 2026-08-10
delivered = 2026-08-03
learning = "The landing is the --hw-* token layer's first real consumer: slice 0 shipped the layer but nothing exercised it, so building the ode surfaced six tokens still missing (pink-deep, two pink washes, surface, serif, mono). Routes /studio and /listen are sold on the page but not linked — they carry an 'in the works' tag instead, since no router is installed until sign-in needs one."

[[feature]]
name = "ATProto sign-in"
start = 2026-08-03
original = 2026-08-17
delivered = 2026-08-03
learning = "Sign-in needed no new backend: client-metadata.json shipped in slice 1 and nginx already served it as application/json, so the real work was the router. Promoting the sold /studio and /listen from in-page anchors to real routes was the slice — deep links stay anonymous and /studio is a signed-out pitch, not a redirect. Handle and avatar both come from one public app.bsky.actor.getProfile call, so remanso.space's getAuthor and its @better-fetch/arktype deps stayed out. BrowserOAuthClient is eagerly imported by the nav sign-in, which pushed the main JS chunk to ~421 kB; code-split it if that starts to hurt."

[[feature]]
name = "Studio — capture to link"
start = 2026-08-17
original = 2026-09-14
status = "on-track"
note = "The two hard pieces land here: OPFS chunk streaming and the windowed multi-track renderer."

[[feature]]
name = "Derush"
start = 2026-09-14
original = 2026-10-05

[[feature]]
name = "Cue track — music, sounds, ambient"
start = 2026-10-05
original = 2026-10-26
note = "Procedural ambient beds live here as one kind of cue clip, not as a standalone page."

[[feature]]
name = "Appview indexes recordings"
start = 2026-10-19
original = 2026-11-02
note = "remanso-jetstream repo. wantedCollections is notes-only today, so nobody can discover anyone else's recordings until this lands."

[[feature]]
name = "Recordings browser — /listen"
start = 2026-10-26
original = 2026-11-09
note = "Own recordings work from listRecords with no appview; the public tier needs the row above."

[[milestone]]
name = "Live at remanso.at"
week = 2026-08-10
requires = ["Domain handover + deploy", "The ode — landing page"]

[[milestone]]
name = "Signed in"
week = 2026-08-17
requires = ["ATProto sign-in"]

[[milestone]]
name = "First episode recorded"
week = 2026-09-14
requires = ["Studio — capture to link"]

[[milestone]]
name = "Real post-production"
week = 2026-10-26
requires = ["Derush", "Cue track — music, sounds, ambient"]

[[milestone]]
name = "1.0"
week = 2026-11-09
requires = [
  "Appview indexes recordings",
  "Recordings browser — /listen",
]
```

Flagging while recording sits in the studio slice rather than derush. It is about ten lines, and it
has to exist at capture time to be worth anything.

PWA identity shipped early, with slice 0 — the manifest, icons and update toast are already live and
match remanso.space. The one piece left is suppressing that toast while a take is recording, which
rides along with the studio slice.

Not in scope: RSS. There is no atproto podcast client, and a real feed would need a caching proxy
somewhere off-box, since everything in this ecosystem shares one host and podcast bursts would
starve the firehose listener. Recordings play in the browser here and inside their note on
remanso.space. The findings are written up in the plan doc if that changes.

## Develop

```bash
pnpm dev           # :5173
pnpm build         # vue-tsc -b && vite build; must be clean, no warnings
pnpm lint          # oxlint  (pnpm lint:fix to autofix)
pnpm fmt           # oxfmt   (pnpm fmt:check to verify only)
```

`pnpm build` warns `@import must precede all rules` when the font `@import url(...)` in
`src/style.css` sits below `@import "tailwindcss"`. The build then drops the font import and text
falls back to system fonts.

## Deploy

Pushes to `main` are picked up by Coolify at https://platform.apoena.dev.

`origin` pushes to both remotes at once. Gitea is authoritative, GitHub is a mirror.

```
fetch  ssh://git@git.apoena.dev:22222/remanso-space/remanso-at.git
push   ssh://git@git.apoena.dev:22222/remanso-space/remanso-at.git
push   git@github.com:remanso-space/remanso-at.git
```

## Related

|                                                             |                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| [remanso.space](https://remanso.space)                      | the writing tool ([repo](https://git.apoena.dev/remanso-space/remanso)) |
| [api.remanso.space](https://api.remanso.space)              | appview over the `space.remanso.note` firehose                          |
| [remanso-cli](https://github.com/remanso-space/remanso-cli) | publishes `*.pub.md` to the PDS                                         |

Lexicons are owned by
[remanso-jetstream](https://git.apoena.dev/julien/remanso-jetstream): `space.remanso.note` and
`space.remanso.recording`, under the `remanso.space` authority.
