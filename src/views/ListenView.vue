<script setup lang="ts">
import { RouterLink } from "vue-router"
</script>

<template>
  <section class="page">
    <div class="page-inner">
      <p class="hw-label eyebrow">§ — listen</p>
      <h1 class="page-title">Recordings, straight from the PDS that holds them.</h1>

      <p class="page-lede">
        This is where you will browse <code class="mono">space.remanso.recording</code> across the
        network. Your own recordings come straight from your PDS with no account needed to read
        them. Everyone else's arrive once the appview learns to index recordings. Each one keeps a
        link back to its note on <a href="https://remanso.space">remanso.space</a>, which stays home
        for the writing.
      </p>

      <div class="page-note">
        <p>
          The browser is being built. Until the appview indexes recordings, there is nothing here to
          list — that work is tracked separately.
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
