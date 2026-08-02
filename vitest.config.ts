import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vitest/config"

// Vitest config lives on its own, apart from vite.config.ts, on purpose: vitest 3
// bundles vite 7's types while this app runs vite 8 (rolldown), so a `test` block on
// vite 8's config type-errors under vue-tsc. This file is excluded from every tsconfig
// (vue-tsc never typechecks it) and vitest transpiles it with esbuild at runtime, so the
// cross-version type clash never surfaces. Keep vite.config.ts free of test config.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
  },
})
