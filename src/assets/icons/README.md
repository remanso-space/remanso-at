# Icons

Tabler outline icons, dropped here as needed: https://tabler.io/icons

Keep `stroke="currentColor"` so the icon follows the surrounding text colour.

- Static colour: `<img src="@/assets/icons/foo.svg" alt="" class="size-5" />`
- Follows `currentColor`: paste the SVG inline as a Vue component (see
  `src/components/RippleMark.vue`)

## Brand icons

Everything in `public/` — `favicon.ico`, `favicon.svg`, `masked-icon.svg`, the `pwa-*`,
`apple-touch-*`, `maskable-*` and `monochromeicon` PNGs — is generated. Edit the source,
never the output:

- `scripts/icons/flower.mjs` — flat vector redraw of the red-ginger mark, used at 64px
  and below where the watercolour turns to mush.
- `scripts/build-icons.mjs` — draws the two ripple rings around it, and around
  `public/mark.png` at 180px and up. Ring count, weight and opacity are tuned per size.

Regenerate with `pnpm icons` and commit the result.

`public/mark.png` is the watercolour hero on the landing page. It has no rings baked in —
`HomeView.vue` animates CSS ripples around it.
