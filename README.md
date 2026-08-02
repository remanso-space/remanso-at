# remanso-at

**Remanso Studio** — an ode to expression and to what you keep in your PDS.

Deployed at https://remanso.at

Sibling to [remanso.space](https://remanso.space), which is the writing tool. This is the other half
of the pair: what happens to a note once it is public.

| Route     | What                                                                                                                                                                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/studio` | Multi-take capture, derush, non-destructive trim, a post-production chain, and music slots — an intro, a break, an outro — filled from openly licensed audio and mixed into the render. Publishes a `space.remanso.recording` and hands you the markdown link to paste into a note. |
| `/listen` | Browse `space.remanso.recording` — yours from your PDS, everyone's from the [appview](https://api.remanso.space) once it indexes them. Notes themselves are not rendered here; links to a note open remanso.space, which stays canonical for `/pub/…`.                              |

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
delivered = 2026-08-17
learning = "Built pure-core-first: the EDL, the windowed render chain (HPF + presence shelf → two-pass -16 LUFS → look-ahead limiter with a hard -1 dBFS guarantee), pause detection and clip assembly are all plain TypeScript with unit tests — the seam-free windowed-equality property and the brick-wall ceiling are asserted directly, so the renderer needed no browser to trust. Only the thin edges are browser-coupled: capture (MediaRecorder → OPFS chunk stream), mediabunny decode/encode, and the StudioView UI. The renderer is a synchronous function, not a Worker yet — fine for 20-minute takes, revisit past ~30 min. canEncodeAudio('opus') gates at session start because there is no original to fall back on. Two gotchas worth keeping: vitest 3 bundles vite 7 types that clash with this app's vite 8, so test config lives in a standalone vitest.config.ts kept out of every tsconfig; and esbuild needed a build-script decision in pnpm-workspace.yaml like sharp did. Flag-while-recording is captured onto the take but nothing consumes it yet — the derush pass that jumps between marks is the next slice."

[[feature]]
name = "Derush"
start = 2026-09-14
original = 2026-10-05
delivered = 2026-09-14
learning = "Slice 4's bet paid: derush is UI over an EDL that already rendered, so the whole pass is pure functions (derush.ts) plus two components, and undo is a list of past EDLs rather than inverse operations. Two design calls worth keeping. Everything the review UI touches is expressed in take seconds, never timeline seconds — a flag stamped at capture, a pause candidate found afterwards and a waveform column all line up under every later edit, and the ripple stays an implementation detail of one relayout function. And the one-button tap/double-tap flag from the plan was dropped for two buttons plus F and R: a double-tap cannot resolve until its window expires, so the mark lands late, and a second tap that misses the window silently becomes two marks — in the one moment of a session where you have no attention to check. One decode per take now feeds peaks, pause candidates, speech onsets and a loudness reading, and the samples stay in memory so publish does not decode a second time. Watch the bundler: a lowercase `select` token anywhere in a source file makes Tailwind emit daisyUI's whole .select component, 8.5 kB of CSS for an event name."

[[feature]]
name = "Music slots — an open-licence library"
start = 2026-10-12
original = 2026-10-12
delivered = 2026-10-12
learning = "The cue track's authoring model was wrong and the sound sources were the wrong sound: an author wants \"something calm under the intro\", not a clip at a snap target, and procedural beds are filtered noise, never music. Slots replaced both, and the cue track survives only as a projection of them — cueClipsFromSlots derives clips on every read, so a slot's length lives in one place and there is no stale clip to keep in sync. Looping fell out of that for free: a short track under a long slot projects to repeated clips with a 0.5 s crossfade at each seam, which the assembler already knew how to mix. Openverse needs no API key because its anonymous limit (20/min, 200/day) is counted per client IP, so each author spends their own budget and no secret ships in the bundle. Two of its three audio providers are usable and the third is the one that hurts: Jamendo is the actual music catalogue, and its storage host pins access-control-allow-origin to an unrelated origin, so the browser cannot read the samples a mix needs — excluded in the query rather than filtered from the results. Licences are CC0 and CC-BY only; CC-BY-SA would push its terms onto the whole episode. Attribution now exists where it said it never would: the recording lexicon gained a credits array, and the markdown link comes back with credit lines under it. CC0 publishes nothing, because CC0 asks for nothing."

[[feature]]
name = "Render off the main thread"
start = 2026-10-19
original = 2026-10-19
delivered = 2026-10-19
learning = "renderSession stayed the pure, tested core — the move was a thin renderSessionInWorker wrapper that runs it in a module Worker (a 7 kB chunk, only the DSP graph, no Vue or atproto). The PCM maps are copied in, not transferred, because the main thread still owns those buffers for playback; only the finished samples transfer back out. A synchronous fallback covers jsdom under test and any browser without module Workers, and it also catches a failed spawn or a thrown render, so a publish never dies on a Worker quirk — same bytes either way, the Worker is a latency win and never a behaviour change. Only the single publish call site changed; the pure render kept every existing test."

[[feature]]
name = "Appview indexes recordings"
start = 2026-10-19
original = 2026-11-02
delivered = 2026-10-19
learning = "Landed in remanso-jetstream: wantedCollections gained space.remanso.recording next to the note, with onCreate/onUpdate/onDelete handlers feeding a recording table indexed by did. No discoverable column — a note can opt out of discovery but every recording is public, so the row is simpler than the note's. GET /recordings and GET /:did/recordings are unauthenticated and unfiltered, and a backfill script sweeps records that predate the subscription. Live at api.remanso.space and already returning indexed recordings; the /listen public tier is the only consumer still to come."

[[feature]]
name = "Recordings browser — /listen"
start = 2026-10-26
original = 2026-11-09
delivered = 2026-10-26
learning = "Two scopes behind one view. A single repo is read straight off its PDS: resolveActor maps a handle or DID to its PDS endpoint and listRecordings pulls that repo's recordings plus the notes that name them with listRecords — public and per-author, no appview in between, so an author sees their own cuts the moment the studio publishes. The everyone tier is the appview's job because a PDS only knows its own repo: listAllRecordings reads api.remanso.space/recordings, then — since the appview holds no blobs — resolves each row's DID to its PDS (cached per DID) to build the same getBlob URL, dropping any row whose DID will not resolve rather than showing an unplayable clip. ListenView defaults to everyone when no repo is in focus (signed out, or ?all=1) and to the named repo otherwise. The appview note link is left off the everyone feed: the index does not say whether a note sits at the recording's rkey, and a link to a maybe-absent note is worse than none. Dropped a stray reverse=true in listPublishedNotes along the way — listRecords already orders by TID descending, so it had been walking from the oldest note."

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
requires = ["Derush", "Music slots — an open-licence library"]

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
