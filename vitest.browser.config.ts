import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import { playwright } from "@vitest/browser-playwright"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vitest/config"

// Browser-mode tests: the ones jsdom cannot answer. Layout at a real viewport width,
// resolved computed styles, scroll widths. Kept apart from vitest.config.ts because that
// one runs jsdom over every *.spec.ts; these are *.browser.spec.ts and need a browser.
//
// Like vitest.config.ts this file is outside every tsconfig, so vue-tsc never typechecks
// it and the vite 7/8 type clash between vitest and the app never surfaces.

// Where scripts/install-browser-deps.sh vendors chromium's shared libraries when the
// machine has none and no root to apt-install them. Absent on CI and on a normal desktop,
// where the browser finds its libraries by itself.
const vendoredLibs =
  process.env.CHROMIUM_DEPS_DIR ?? path.join(homedir(), ".local/share/chromium-deps")

if (existsSync(vendoredLibs)) {
  process.env.LD_LIBRARY_PATH = [
    path.join(vendoredLibs, "usr/lib/x86_64-linux-gnu"),
    path.join(vendoredLibs, "lib/x86_64-linux-gnu"),
    process.env.LD_LIBRARY_PATH,
  ]
    .filter(Boolean)
    .join(":")
  // Without this, fontconfig searches the system directories, finds no font at all, and
  // chromium lays every string out with zero-width glyphs — text is then invisible and
  // every size assertion reads 0.
  process.env.FONTCONFIG_FILE = path.join(vendoredLibs, "fonts.conf")
}

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.browser.spec.ts"],
    setupFiles: ["./src/test/browser.setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          // The headless shell is what install-browser-deps.sh downloads.
          channel: "chromium-headless-shell",
          // The container has no user namespaces for chromium's sandbox, and the only
          // code it loads is this repo's own test bundle.
          args: ["--no-sandbox"],
        },
      }),
      // 390x844 is an iPhone 14/15 in portrait — the narrow end of what the studio has to
      // survive. Individual tests can shrink the frame further; none of them may widen it.
      viewport: { width: 390, height: 844 },
      instances: [{ browser: "chromium" }],
    },
  },
})
