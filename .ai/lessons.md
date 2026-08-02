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

**How to apply:** in this project, an accented box gets its accent on the *whole* border —
`border: 2px solid var(--hw-pink)`, or `border-color:` overriding a neutral base. Do not introduce
`border-left`/`border-inline-start` accent bars.

---

2026-08-02. Jean reported the update toast unreachable; I "fixed" the dev service worker
registration and declared it done. He came back: still unreachable, and specifically on `/studio`.
The route detail was the whole clue and I had skipped past it — the studio is the only page that
touches `useTakeRecorder`, and the recorder is the only writer of the module-level flag that gates
the toast. `stop()` called `rec.stop()` unguarded, so an already-inactive recorder threw on the way
out, `teardown()` never ran, and the flag stayed `true` for the rest of the session.

**How to apply:** when a bug report names a route, a screen or a step, treat that scope as the
strongest evidence available and ask what is unique to it before touching anything global. And when
a piece of shared state is cleared by a cleanup path, put that cleanup in `finally` — a flag that
suppresses UI elsewhere in the app must not depend on a happy path completing.

---

2026-08-02 (same toast, third round). Jean: "Well in every page in fact." I had shipped two real
fixes — the dev service worker, then a wedged recording flag — and each time treated a plausible
mechanism as the answer without ever seeing the toast fail. The actual complaint was simpler than
any mechanism: the toast has no trigger a person can pull. `offlineReady` fires once per browser,
ever; `needRefresh` needs a deploy to land while the tab is open. Nothing was broken about being
unable to summon it, and no amount of bug-hunting was going to produce one.

**How to apply:** "I can't see X" is not always "X is broken". Before hunting, ask what the
user would have to do to make X appear, and if the honest answer is "wait for a rare event", the
fix is a trigger, not a repair. Also: when the browser tooling is unavailable and I cannot
reproduce, say so on the first turn and ask for a console line, instead of shipping a confident
diagnosis built out of static reading.
