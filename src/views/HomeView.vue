<script setup lang="ts">
import { RouterLink } from "vue-router"

// Injected at build time from package.json — the version is written in exactly one place.
const version = __APP_VERSION__
</script>

<template>
  <!-- ── Hero: the ode ─────────────────────────────────── -->
  <section class="hero">
    <div class="hero-inner">
      <div class="hero-left">
        <p class="hw-label eyebrow">§ — remanso studio · v{{ version }}</p>
        <h1 class="display">
          Say it out loud,<br />
          and keep it where<br />
          <em>your words already live.</em>
        </h1>
        <p class="lede">
          Remanso Studio records, cuts and mixes audio in the browser, then hands you a markdown
          link to paste into a note. The recording lands in your own PDS, next to everything else
          you have published. There is no upload to a platform you do not own.
        </p>
        <p class="hero-sample">
          The writing half lives at
          <a href="https://remanso.space">remanso.space</a>. This is the half that speaks.
        </p>
      </div>
      <div class="hero-right">
        <div class="pool">
          <img src="/mark.png" alt="Remanso" class="pool-mark" width="180" height="180" />
          <div class="ripple" />
          <div class="ripple r2" />
        </div>
      </div>
    </div>
  </section>

  <!-- ── The two rooms ─────────────────────────────────── -->
  <section class="rooms">
    <div class="rooms-inner">
      <RouterLink to="/studio" class="room room-link">
        <div class="room-head">
          <span class="room-n mono">01</span>
          <div>
            <div class="room-t">The studio</div>
            <code class="mono room-route">/studio</code>
          </div>
          <span class="room-tag mono">live</span>
        </div>
        <p class="room-copy">
          Record a take from your microphone, or bring a file you recorded elsewhere. Trim the ends,
          drop the long pauses, and set the loudness once so it plays at the level a podcast should.
          Put music under the intro, the breaks, the ending. When it sounds right, publish a
          <code class="mono">space.remanso.recording</code> to your PDS and copy the link. Paste it
          into a note and the audio plays where the note is read.
        </p>
      </RouterLink>

      <RouterLink to="/listen" class="room room-link">
        <div class="room-head">
          <span class="room-n mono">02</span>
          <div>
            <div class="room-t">Listen</div>
            <code class="mono room-route">/listen</code>
          </div>
          <span class="room-tag mono">live</span>
        </div>
        <p class="room-copy">
          Play what people have been recording, newest first, without an account. Each one shows its
          length, the day it went up, and credit to whoever made the music underneath. Narrow the
          list to one person and every recording also links back to the note it belongs to on
          <a href="https://remanso.space">remanso.space</a>, which stays home for the writing.
        </p>
      </RouterLink>
    </div>
  </section>

  <!-- ── What remanso means ────────────────────────────── -->
  <section class="manifesto">
    <div class="manifesto-inner">
      <p class="hw-label">§ 01 — what remanso means</p>
      <p class="drop-cap manifesto-p">
        <em>Remanso</em> is a Portuguese word for the still pool that forms where a river slows. The
        water keeps moving through it, but for a stretch it holds calm enough to see the bottom.
        remanso.space gave that to writing. Remanso Studio gives it to sound: somewhere to record a
        thing, work it until it is clear, and set it down where it will keep.
      </p>
    </div>
  </section>

  <!-- ── How it works ──────────────────────────────────── -->
  <section class="how">
    <div class="how-inner">
      <p class="hw-label">§ 02 — from a take to a note</p>
      <ol class="steps">
        <li>
          <span class="step-n mono">01</span>
          <div>
            <h3>Record, and mark as you go</h3>
            <p>
              Speak into your microphone and watch the level as you talk. When a line comes out
              wrong, tap a key to flag the spot, say it again, and carry on. Record as many takes as
              you like. Nothing is lost if you reload the page or close the tab mid-sentence.
            </p>
          </div>
        </li>
        <li>
          <span class="step-n mono">02</span>
          <div>
            <h3>Cut it down</h3>
            <p>
              Scrub the waveform, jump between your flags, and throw out the parts you do not want.
              The long pauses go in one click, the flagged fumbles in another. Mark chapters where
              the subject turns. Anything you regret, undo.
            </p>
          </div>
        </li>
        <li>
          <span class="step-n mono">03</span>
          <div>
            <h3>Put music under it</h3>
            <p>
              Search freely licensed music from inside the studio and hear a track before you commit
              to it. Drop it under the intro, the chapter breaks, or the ending. Music under speech
              steps back so your voice stays in front, and whoever made the track gets credited
              alongside the recording.
            </p>
          </div>
        </li>
        <li>
          <span class="step-n mono">04</span>
          <div>
            <h3>Hear the whole thing, then publish</h3>
            <p>
              Play the finished cut end to end before anyone else hears it. It comes out evened to a
              steady listening level, so nobody reaches for the volume. Then publish it to your own
              account, where it sits beside everything else you have written.
            </p>
          </div>
        </li>
      </ol>

      <!-- The attach story: the studio's best trick, and the one nobody expects. -->
      <aside class="attach">
        <p class="hw-label attach-label">the note never has to change</p>
        <p class="attach-p">
          Pick one of your notes before you publish, and the recording finds its way onto it. There
          is nothing to paste and nothing to edit. Your writing stays word for word as you left it,
          and the audio is waiting there the next time someone opens the page. Record a second
          version months later and it takes the same place, so every link anyone has shared still
          plays.
        </p>
      </aside>
    </div>
  </section>

  <!-- ── Sibling ───────────────────────────────────────── -->
  <section class="sibling">
    <div class="sibling-inner">
      <p class="hw-label">§ 03 — one account, two tools</p>
      <p class="sibling-p">
        remanso.space is where you write. Remanso Studio is where you record. They share a handle, a
        mark, and the same habit of keeping your work in markdown you can take anywhere. Sign in on
        either with the account you already have.
      </p>
      <a href="https://remanso.space" class="sibling-cta">Open remanso.space →</a>
    </div>
  </section>
</template>

<style scoped>
.mono {
  font-family: var(--hw-mono);
}

/* ── Hero ────────────────────────────────────────────────── */
.hero {
  padding: 4.5rem 2rem 3.5rem;
}

.hero-inner {
  max-width: 1140px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.25fr 1fr;
  gap: 4rem;
  align-items: center;
}

.eyebrow {
  margin-bottom: 1.5rem;
  color: var(--hw-pink-deep);
}

.display {
  font-size: clamp(2.4rem, 5.3vw, 4.3rem);
  line-height: 1.04;
  letter-spacing: -0.01em;
  font-weight: 600;
  margin: 0 0 1.75rem;
  text-wrap: balance;
}

.display em {
  font-style: italic;
  font-weight: 400;
  color: var(--hw-pink-deep);
}

.lede {
  font-size: 1.18rem;
  line-height: 1.55;
  color: var(--hw-ink-soft);
  max-width: 40ch;
  margin: 0 0 1.5rem;
  text-wrap: pretty;
}

.hero-sample {
  font-size: 0.95rem;
  color: var(--hw-ink-faint);
  margin: 0;
}

.hero-right {
  display: flex;
  justify-content: center;
}

.pool {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.pool-mark {
  position: relative;
  z-index: 2;
  object-fit: contain;
}

.ripple {
  position: absolute;
  inset: 12%;
  border: 3px solid var(--hw-pink-wash-2);
  border-radius: 50%;
  animation: ripple 4.5s ease-out infinite;
}

.ripple.r2 {
  animation-delay: 1.8s;
}

@keyframes ripple {
  0% {
    transform: scale(0.6);
    opacity: 0;
  }
  30% {
    opacity: 0.55;
  }
  100% {
    transform: scale(1.35);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ripple {
    animation: none;
    opacity: 0.4;
  }
}

/* ── Rooms ───────────────────────────────────────────────── */
.rooms {
  padding: 1rem 2rem 3rem;
}

.rooms-inner {
  max-width: 1140px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}

.room {
  padding: 2rem 1.9rem;
  background: var(--hw-surface);
  border: 1px solid var(--hw-rule);
  border-radius: 6px;
}

/* The room cards are now real route links; keep them reading as cards, not links. */
.room-link {
  display: block;
  text-decoration: none;
  color: inherit;
  transition:
    border-color 0.15s,
    transform 0.15s;
}

.room-link:hover {
  border-color: var(--hw-pink-deep);
  transform: translateY(-2px);
}

.room-head {
  display: flex;
  align-items: baseline;
  gap: 0.85rem;
  margin-bottom: 1.1rem;
}

.room-n {
  font-size: 0.85rem;
  letter-spacing: 0.12em;
  color: var(--hw-pink-deep);
}

.room-t {
  font-size: 1.4rem;
  font-weight: 600;
  line-height: 1.1;
}

.room-route {
  font-size: 0.8rem;
  color: var(--hw-ink-faint);
}

.room-tag {
  margin-left: auto;
  font-size: 0.66rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--hw-ink-faint);
  border: 1px solid var(--hw-rule);
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  align-self: center;
}

.room-copy {
  margin: 0;
  color: var(--hw-ink-soft);
  font-size: 1.02rem;
  line-height: 1.55;
  text-wrap: pretty;
}

.room-copy code {
  font-family: var(--hw-mono);
  font-size: 0.85em;
  background: var(--hw-pink-wash);
  color: var(--hw-pink-deep);
  padding: 0.05em 0.35em;
  border-radius: 3px;
}

/* ── Manifesto ───────────────────────────────────────────── */
.manifesto {
  padding: 2.5rem 2rem;
  border-top: 1px solid var(--hw-rule);
}

.manifesto-inner {
  max-width: 720px;
  margin: 0 auto;
}

.manifesto-p {
  font-size: 1.28rem;
  line-height: 1.6;
  margin: 1.25rem 0 0;
  text-wrap: pretty;
}

.manifesto-p em {
  font-style: italic;
  color: var(--hw-pink-deep);
}

.drop-cap::first-letter {
  float: left;
  font-size: 4.4em;
  line-height: 0.85;
  font-weight: 600;
  margin: 0.08em 0.1em 0 0;
  color: var(--hw-pink-deep);
}

/* ── How ─────────────────────────────────────────────────── */
.how {
  padding: 2.5rem 2rem 3rem;
  border-top: 1px solid var(--hw-rule);
  background: linear-gradient(
    180deg,
    transparent,
    color-mix(in srgb, var(--hw-pink-wash) 35%, transparent) 45%,
    transparent
  );
}

.how-inner {
  max-width: 720px;
  margin: 0 auto;
}

.steps {
  list-style: none;
  padding: 0;
  margin: 1.25rem 0 0;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.steps li {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1.5rem;
  padding: 1.1rem 0;
  border-bottom: 1px dashed var(--hw-rule);
}

.steps li:last-child {
  border-bottom: 0;
}

.step-n {
  font-size: 0.95rem;
  color: var(--hw-pink-deep);
  letter-spacing: 0.1em;
  padding-top: 0.35rem;
}

.steps h3 {
  font-size: 1.3rem;
  font-weight: 600;
  margin: 0 0 0.35rem;
}

.steps p {
  margin: 0;
  color: var(--hw-ink-soft);
  line-height: 1.55;
  text-wrap: pretty;
}

/* The attach callout reads as a pressed-in note in the margin, not a banner ad. */
.attach {
  margin: 2rem 0 0;
  padding: 1.4rem 1.6rem;
  background: var(--hw-surface);
  border: 1px solid var(--hw-rule);
  border-left: 3px solid var(--hw-pink-deep);
  border-radius: 3px;
}

.attach-label {
  color: var(--hw-pink-deep);
  margin: 0 0 0.6rem;
}

.attach-p {
  margin: 0;
  font-size: 1.08rem;
  line-height: 1.6;
  color: var(--hw-ink);
  text-wrap: pretty;
}

/* ── Sibling ─────────────────────────────────────────────── */
.sibling {
  padding: 2.5rem 2rem 3rem;
  border-top: 1px solid var(--hw-rule);
}

.sibling-inner {
  max-width: 720px;
  margin: 0 auto;
}

.sibling-p {
  font-size: 1.15rem;
  line-height: 1.6;
  color: var(--hw-ink);
  margin: 1.25rem 0 1.5rem;
  text-wrap: pretty;
}

.sibling-cta {
  display: inline-flex;
  align-items: center;
  padding: 0.6rem 1.1rem;
  font-family: var(--hw-serif);
  font-weight: 600;
  border: 1px solid var(--hw-ink);
  border-radius: 2px;
  color: var(--hw-ink);
  background: transparent;
  text-decoration: none;
}

.sibling-cta:hover {
  background: var(--hw-ink);
  color: var(--hw-paper);
  text-decoration: none;
}

/* ── Responsive ──────────────────────────────────────────── */
@media (max-width: 900px) {
  .hero-inner {
    grid-template-columns: 1fr;
    gap: 2rem;
  }

  .hero-right {
    order: -1;
  }

  .pool-mark {
    width: 130px;
    height: 130px;
  }

  .rooms-inner {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .hero {
    padding: 3rem 1.25rem 2.5rem;
  }

  .rooms,
  .manifesto,
  .how,
  .sibling {
    padding-left: 1.25rem;
    padding-right: 1.25rem;
  }
}
</style>
