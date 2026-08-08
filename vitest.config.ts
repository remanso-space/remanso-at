import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vitest/config"

import pkg from "./package.json" with { type: "json" }

// Apart from vite.config.ts on purpose: vitest bundles vite 7's types while this app runs
// vite 8 (rolldown), so a `test` block on vite 8's config type-errors under vue-tsc. This
// file is excluded from every tsconfig and vitest transpiles it with esbuild at runtime, so
// the clash never surfaces. Keep vite.config.ts free of test config.
export default defineConfig({
  plugins: [vue()],
  // Mirrors vite.config.ts so components reading the version mount under test.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "virtual:pwa-register/vue": fileURLToPath(
        new URL("./src/test/pwaRegisterStub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
    // *.browser.spec.ts belongs to vitest.browser.config.ts: it imports `vitest/browser`,
    // which has nothing to talk to in node, so collecting it here only ever fails.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.browser.spec.ts"],
  },
})
