import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      // Deliberately omits favicon.png, which remanso.space does include. It is the
      // 1.4 MB source image for the asset generator and nothing in the HTML references
      // it, so precaching it would be ~22x the size of the entire JS bundle.
      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "apple-touch-icon-180x180.png",
        "pwa-64x64.png",
        "pwa-192x192.png",
        "pwa-512x512.png",
        "masked-icon.png",
        "maskable-icon-512x512.png",
        "monochromeicon.png",
      ],
      // Same identity as remanso.space: one brand, one mark, one colour.
      manifest: {
        name: "Remanso",
        short_name: "Remanso",
        description: "Note taking & sharing app",
        background_color: "#ffa4c0",
        theme_color: "#ffa4c0",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "monochromeicon.png",
            sizes: "1024x1024",
            type: "image/png",
            purpose: "monochrome",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})
