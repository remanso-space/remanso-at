<script setup lang="ts">
import NewVersion from "./components/NewVersion.vue"

const routes = [
  { path: "/studio", label: "record it, cut it, mix it" },
  { path: "/listen", label: "browse what has been recorded" },
]
</script>

<template>
  <main class="mx-auto flex min-h-svh max-w-2xl flex-col justify-center px-6 py-16">
    <p class="hw-label">§ 00 — still filling</p>

    <h1 class="mt-6 flex items-center gap-4 text-5xl font-bold text-[var(--hw-ink)]">
      <img src="/pwa-192x192.png" alt="" class="size-12 shrink-0" />
      Remanso Studio
    </h1>

    <p class="mt-6 text-[var(--hw-ink-soft)]">
      An ode to expression and to what you keep in your PDS. Sibling to
      <a href="https://remanso.space">remanso.space</a>, which is the writing tool. This is the
      other half of the pair: what happens to a note once it is public.
    </p>

    <ul class="mt-10 border-t border-[var(--hw-rule)]">
      <li
        v-for="route in routes"
        :key="route.path"
        class="flex items-baseline gap-4 border-b border-[var(--hw-rule)] py-3"
      >
        <code class="font-mono text-sm text-primary">{{ route.path }}</code>
        <span class="text-[var(--hw-ink-soft)]">{{ route.label }}</span>
      </li>
    </ul>

    <p class="mt-10 text-sm text-[var(--hw-ink-faint)]">
      Nothing here works yet. The plan is in the
      <a href="https://git.apoena.dev/remanso-space/remanso-at">README</a>.
    </p>

    <NewVersion />
  </main>
</template>
