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
