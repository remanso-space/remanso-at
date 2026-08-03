# Lessons

## Do not delete a justification just because one of its uses expired

2026-08-02. When ATProto sign-in moved ahead of the ambient room, I rewrote the ambient feature's
`note` in the macroplan, dropping "no auth, no storage" because "no auth" no longer argued for
ordering ambient before sign-in. Jean pushed back, correctly.

The phrase was carrying three claims, and only one of them was about ordering:

1. `/ambient` is reachable without an account. A permanent product property, and the reason it has
   no navigation guard — it is the one thing a first-time visitor can use with no commitment.
2. It needs no storage: no OPFS, no IndexedDB, no quota checks, no recovery flow. This is why it is
   a 1-2 day slice.
3. Therefore it can ship before sign-in. This is the only part the reorder invalidated.

(Postscript: the `/ambient` page was cut entirely a few hours later — ambient sound was always meant
to be mixed into recordings, not offered as a listening room. That does not change the lesson, which
is about how I edited, not about which feature was right.)

**How to apply:** before removing a rationale during a refactor or reorder, enumerate what it
asserts and check each claim separately. A sentence that no longer justifies a _sequence_ may still
justify the _scope_, the _cost_, or a _product guarantee_. Narrow the claim rather than deleting the
sentence.

---

2026-08-02. Jean: "make border pink everywhere, stop to try to have only the left border colored."
I had reached for the editorial left-accent bar (`border: 1px solid var(--hw-rule); border-left:
3px solid var(--hw-pink)`) on the update toast and on `.page-note.danger`. It reads as a stylistic
tic here, not as the brand.

**How to apply:** in this project, an accented box gets its accent on the _whole_ border —
`border: 2px solid var(--hw-pink)`, or `border-color:` overriding a neutral base. Do not introduce
`border-left`/`border-inline-start` accent bars.

---

2026-08-02. The update toast was invisible. Root cause, confirmed by Jean: **z-index**. `App.vue`
puts `z-index: 1` on `.nav`, `main` and `.footer`; the toast teleports to `<body>` at `z-index:
auto`, so it painted under all three no matter where it sat in the DOM. One line fixed it —
`z-index: 100` on `.toast`.

I found that line in my first pass and shipped it silently, mixed in with a border change, then
spent two more rounds hunting mechanisms (a dev service worker that never registered, a wedged
recording flag) because I never confirmed whether the first change had worked. The browser
extension was disconnected the whole time, so I was reasoning from static reads and calling each
hypothesis a root cause.

**How to apply:** three things. (1) State every change and its intent, even a one-liner — an
unannounced fix cannot be confirmed or ruled out, and it turns the next round into guesswork.
(2) When I cannot reproduce, say so in the first reply and ask for one observation (a screenshot,
a computed style, a console line) instead of shipping a confident diagnosis. (3) For an invisible
element, check the paint stack before the logic: teleporting to `<body>` escapes ancestor clipping
but does nothing about a sibling with a higher `z-index`. Any new fixed overlay in this app needs
an explicit `z-index` above 1.

(The two side fixes were real defects and are covered by tests, but neither was this bug.)

---

2026-08-02 (slice 6). The cue-track panel pushed the main CSS bundle from 69.89 kB to 72.49 kB.
I already knew the slice-4 rule — a lowercase `select` token makes Tailwind emit daisyUI's whole
`.select` component — but I read it as being about class names and event names, and I chased the
`<input>` element and a bare `input` identifier before finding the real culprit: the word
**`dropdown` in a code comment**. Tailwind scans comments too, so `.dropdown` (2.6 kB) shipped for
a sentence describing the UI. Renaming the word restored the byte-identical 69.89 kB bundle.

**How to apply:** the daisyUI-token trap is wider than a class name. Keep component words
(`dropdown`, `menu`, `select`, `input`, `card`, `range`, `steps`, `tab`, `modal`, `drawer`, …) out
of source **entirely — comments included**. After adding any component, diff the built CSS: grep
`dist/assets/index-*.css` for `\.(dropdown|menu|select|card|…)\{` and confirm the set matches the
baseline, not just the byte size. And measure a true baseline with `git stash -u` (untracked new
files included) before blaming a change — my first "baseline" build left the new untracked modules
on disk and told me nothing.

---

2026-08-03. Jean sent a screenshot of the `/listen` handle box: a native `<datalist>` popup with
its one option rendering near-white on white. I wrote **"Your OS is in dark mode"** as the cause.
Jean: "this is not the first time you're wrong about the OS theme." I had inferred a machine setting
from rendered pixels and stated it as fact.

The screenshot supported exactly one claim — the option text is unreadable. Everything after that
was invention. Native form popups in Chrome on Linux take their colors from the GTK theme, which is
not the same switch as a "dark mode" toggle, so several configurations produce this. The cause is
still unknown, and I have not established it.

The fix I shipped (`color-scheme: light` on `html`, `src/style.css`) is defensible on its own terms:
the palette is hardcoded paper — `--hw-surface: #ffffff`, ink on light, no dark variant anywhere —
so declaring the only scheme that exists is right whether or not it addresses that popup. That is
the argument I should have made, with no causal story attached.

**How to apply:** when reading a screenshot, separate what is rendered from why. Describe the
former; for the latter, either ask for the one observation that settles it (GTK theme, DevTools
`prefers-color-scheme`, a computed style) or justify the fix without naming a cause. Never assert
Jean's OS theme, browser settings, or any local configuration — it is unobservable from here, and
this is a repeat offence, not a one-off.
