# remanso-at

An ode to expression and to what you keep in your PDS.

Deployed at https://remanso.at

Sibling to [remanso.space](https://remanso.space), which is the writing tool. This is the other half
of the pair: what happens to a note once it is public.

| Route | What |
| --- | --- |
| `/listen` | Published `space.remanso.note` records from the [appview](https://api.remanso.space), rendered plainly. remanso.space stays canonical for `/pub/…` URLs; this reader links back with `rel="canonical"`. |
| `/studio` | Multi-take capture, derush, non-destructive trim, a post-production chain, and spot-placed music or ambient cues. Publishes a `space.remanso.recording` and hands you the markdown link to paste into a `.pub.md` note. |
| `/ambient` | Procedurally generated beds. Nothing is sampled, so there is nothing to license and no loop seams. |

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

## Plan

```macroplan
title = "remanso.at"
start = 2026-08-03
end = 2026-11-23

[[feature]]
name = "Domain handover + deploy"
start = 2026-08-03
original = 2026-08-03
status = "on-track"
note = "remanso.at freed from the remanso.space Coolify app; new app needs the hostname plus www."

[[feature]]
name = "The ode — landing page"
start = 2026-08-03
original = 2026-08-10
status = "on-track"
note = "House stack plus the --hw-* token layer lifted from WelcomeWorld.vue."

[[feature]]
name = "ATProto sign-in"
start = 2026-08-10
original = 2026-08-17
status = "on-track"
note = "Own client-metadata.json as Remanso Studio; sessions cannot be shared with remanso.space."

[[feature]]
name = "Ambient room"
start = 2026-08-17
original = 2026-08-24
status = "on-track"
note = "Still ahead of the studio, so the pure-TS DSP engine is proven before the renderer needs it."

[[feature]]
name = "Studio — capture to link"
start = 2026-08-24
original = 2026-09-21
status = "on-track"
note = "The two hard pieces land here: OPFS chunk streaming and the windowed multi-track renderer."

[[feature]]
name = "Derush"
start = 2026-09-21
original = 2026-10-12

[[feature]]
name = "Cue track — music & sounds"
start = 2026-10-12
original = 2026-11-02

[[feature]]
name = "Reader — /listen"
start = 2026-11-02
original = 2026-11-16

[[feature]]
name = "PWA"
start = 2026-11-16
original = 2026-11-23

[[milestone]]
name = "Live at remanso.at"
week = 2026-08-10
requires = ["Domain handover + deploy", "The ode — landing page"]

[[milestone]]
name = "Sign in and listen to noise"
week = 2026-08-24
requires = ["ATProto sign-in", "Ambient room"]

[[milestone]]
name = "First episode recorded"
week = 2026-09-21
requires = ["Studio — capture to link"]

[[milestone]]
name = "Real post-production"
week = 2026-11-02
requires = ["Derush", "Cue track — music & sounds"]

[[milestone]]
name = "1.0"
week = 2026-11-23
requires = [
  "Reader — /listen",
  "PWA",
]
```

Flagging while recording sits in the studio slice rather than derush. It is about ten lines, and it
has to exist at capture time to be worth anything.

Not in scope: RSS. There is no atproto podcast client, and a real feed would need a caching proxy
somewhere off-box, since everything in this ecosystem shares one host and podcast bursts would
starve the firehose listener. Episodes play on their note's page. The findings are written up in the
plan doc if that changes.

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

| | |
| --- | --- |
| [remanso.space](https://remanso.space) | the writing tool ([repo](https://git.apoena.dev/remanso-space/remanso)) |
| [api.remanso.space](https://api.remanso.space) | appview over the `space.remanso.note` firehose |
| [remanso-cli](https://github.com/remanso-space/remanso-cli) | publishes `*.pub.md` to the PDS |

Lexicons are owned by
[remanso-jetstream](https://git.apoena.dev/julien/remanso-jetstream): `space.remanso.note` and
`space.remanso.recording`, under the `remanso.space` authority.
