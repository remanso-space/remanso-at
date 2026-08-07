<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router"
import { AtprotoLogin } from "vue-atproto-login"

import NewVersion from "./components/NewVersion.vue"

// Sign-in is `vue-atproto-login`'s component: the OAuth client, the callback, the identity
// cache and the handle typeahead all live there. It is configured once in main.ts; nothing
// here talks to @atproto/oauth-client-browser directly any more.

// Injected at build time from package.json — the version is written in exactly one place.
const version = __APP_VERSION__
</script>

<template>
  <div class="ode">
    <!-- ── Nav ─────────────────────────────────────────────── -->
    <nav class="nav">
      <RouterLink to="/" class="brand">
        <img src="/mark.png" alt="" class="brand-mark" width="28" height="28" />
        <span class="brand-word">Remanso Studio</span>
      </RouterLink>
      <div class="nav-right">
        <RouterLink to="/studio" class="navlink">The studio</RouterLink>
        <RouterLink to="/listen" class="navlink">Listen</RouterLink>
        <a href="https://remanso.space" class="navlink">remanso.space</a>
        <AtprotoLogin with-avatar with-sign-out sign-in-label="Sign in" />
      </div>
    </nav>

    <main>
      <RouterView />
    </main>

    <!-- ── Footer ────────────────────────────────────────── -->
    <footer class="footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <img src="/mark.png" alt="" width="30" height="30" />
          <div>
            <div class="footer-title">Remanso Studio</div>
            <div class="footer-sub mono">record it, then let it settle</div>
          </div>
        </div>
        <div class="footer-links">
          <a href="https://remanso.space">remanso.space</a>
          <a href="https://atproto.com/">atproto</a>
          <a href="https://git.apoena.dev/remanso-space/remanso-at">source</a>
        </div>
      </div>
      <div class="footer-fine mono">
        <span>made by <a href="https://apoena.dev">apoena.dev ↗</a></span>
        <span class="footer-version">v{{ version }}</span>
      </div>
    </footer>

    <NewVersion />
  </div>
</template>

<style scoped>
.ode {
  font-family: var(--hw-serif);
  color: var(--hw-ink);
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* Two faint radial washes, lifted from remanso.space's editorial page. Behind everything
   at z-index -1 rather than above the page at 0: at 0 the wash paints over ordinary content
   and every section has to bid above it, which sets a floor any overlay then has to clear
   too — that is how the update toast ended up buried. Safe because html carries the paper
   background and body sets none, so the canvas still paints behind this. */
.ode::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  background-image:
    radial-gradient(circle at 18% 8%, rgba(227, 101, 152, 0.05), transparent 42%),
    radial-gradient(circle at 88% 82%, rgba(107, 142, 78, 0.04), transparent 46%);
}

main {
  position: relative;
  flex: 1;
}

.mono {
  font-family: var(--hw-mono);
}

/* ── Nav ─────────────────────────────────────────────────── */
.nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 2rem;
  border-bottom: 1px solid var(--hw-rule);
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  text-decoration: none;
  color: var(--hw-ink);
  font-weight: 600;
}

.brand-word {
  font-size: 1.15rem;
  letter-spacing: 0.01em;
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  flex-wrap: wrap;
}

.navlink {
  color: var(--hw-ink-soft);
  font-size: 0.95rem;
  font-weight: 400;
  text-decoration: none;
}

.navlink:hover,
.navlink.router-link-active {
  color: var(--hw-pink-deep);
}

/* Home is active for every path, so it never gets the accent. */
.brand.router-link-active {
  color: var(--hw-ink);
}

/* ── Footer ──────────────────────────────────────────────── */
.footer {
  position: relative;
  border-top: 1px solid var(--hw-rule);
  padding: 3rem 2rem 2rem;
  margin-top: 3rem;
  background: linear-gradient(180deg, transparent, var(--hw-paper-warm));
}

.footer-inner {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 2rem;
  flex-wrap: wrap;
}

.footer-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.footer-title {
  font-weight: 600;
}

.footer-sub {
  font-size: 0.78rem;
  color: var(--hw-ink-faint);
  letter-spacing: 0.02em;
}

.footer-links {
  display: flex;
  gap: 1.5rem;
}

.footer-links a {
  color: var(--hw-ink-soft);
  font-weight: 400;
  text-decoration: none;
}

.footer-links a:hover {
  color: var(--hw-pink-deep);
}

.footer-fine {
  max-width: 1100px;
  margin: 2rem auto 0;
  padding-top: 1.25rem;
  border-top: 1px dashed var(--hw-rule);
  display: flex;
  gap: 0.6rem;
  align-items: center;
  font-size: 0.8rem;
  color: var(--hw-ink-faint);
}

.footer-version {
  margin-left: auto;
}

/* ── Responsive ──────────────────────────────────────────── */
@media (max-width: 640px) {
  .nav {
    padding: 1rem 1.25rem;
  }

  .nav-right {
    gap: 0.9rem;
  }

  /* Drop the outbound remanso.space link on mobile; the footer keeps it. */
  .nav-right > .navlink:nth-child(3) {
    display: none;
  }

  .footer {
    padding-left: 1.25rem;
    padding-right: 1.25rem;
  }

  .footer-inner {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
