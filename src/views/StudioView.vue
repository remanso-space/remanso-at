<script setup lang="ts">
import { useSession } from "../composables/useSession"

const { isLoggedIn, handle } = useSession()
</script>

<template>
  <section class="page">
    <div class="page-inner">
      <p class="hw-label eyebrow">§ — the studio</p>
      <h1 class="page-title">Record it here, keep it in your PDS.</h1>

      <p class="page-lede">
        The studio records a take from your microphone, or takes a file you recorded elsewhere. It
        trims the ends, drops the long pauses, levels the whole thing to
        <code class="mono">-16 LUFS</code>, and mixes in music or a bed of river sound where a
        segment needs it. When it sounds right, it publishes a
        <code class="mono">space.remanso.recording</code> to your PDS and hands back one line of
        markdown to paste into a note.
      </p>

      <div v-if="isLoggedIn" class="page-note">
        <p>
          Signed in as <span class="mono">{{ handle }}</span
          >. The recording room itself lands in a coming release — this page will grow the mic, the
          take list and the render there. Nothing here writes to your PDS yet.
        </p>
      </div>
      <div v-else class="page-note">
        <p>
          Sign in with your atproto handle from the top of the page to record against your own PDS.
          You can read everything here signed out; only publishing needs an account.
        </p>
      </div>

      <RouterLink to="/" class="page-back">← Back to the ode</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.page {
  padding: 4rem 2rem 3rem;
}

.page-inner {
  max-width: 720px;
  margin: 0 auto;
}

.mono {
  font-family: var(--hw-mono);
}

.eyebrow {
  margin-bottom: 1.25rem;
  color: var(--hw-pink-deep);
}

.page-title {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.08;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0 0 1.5rem;
  text-wrap: balance;
}

.page-lede {
  font-size: 1.18rem;
  line-height: 1.6;
  color: var(--hw-ink-soft);
  margin: 0 0 1.75rem;
  text-wrap: pretty;
}

.page-lede code {
  font-family: var(--hw-mono);
  font-size: 0.85em;
  background: var(--hw-pink-wash);
  color: var(--hw-pink-deep);
  padding: 0.05em 0.35em;
  border-radius: 3px;
}

.page-note {
  border: 1px solid var(--hw-rule);
  border-radius: 6px;
  background: var(--hw-surface);
  padding: 1.1rem 1.3rem;
  margin: 0 0 2rem;
}

.page-note p {
  margin: 0;
  color: var(--hw-ink-soft);
  line-height: 1.55;
}

.page-note .mono {
  color: var(--hw-pink-deep);
}

.page-back {
  color: var(--hw-ink-faint);
  text-decoration: none;
  font-size: 0.95rem;
}

.page-back:hover {
  color: var(--hw-pink-deep);
}

@media (max-width: 640px) {
  .page {
    padding: 3rem 1.25rem 2.5rem;
  }
}
</style>
