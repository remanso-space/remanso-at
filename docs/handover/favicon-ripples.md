# Favicon — ripples around the mark

Decided and shipped 2026-08-02. Records why the icons look the way they do, so nobody
re-litigates it or hand-edits a generated PNG.

## The idea

Remanso Studio is the half of Remanso that speaks. The landing page already animates two
CSS ripple rings out of the flower mark (`HomeView.vue`, `.ripple` / `.ripple.r2`) — your
voice going out from you. The icon did not carry that; it was the bare watercolour flower,
which at 16px is a pink smudge and says nothing about sound.

So: keep the flower, put ripples around it.

## What was rejected

Four other treatments were built and compared at real 16/32px in a scratch page
(`/favicon-lab`, unlisted, still live):

- **Side arcs** — mirrored arcs left and right. Correct broadcast grammar, but it is the
  wifi/RSS idiom and reads as a generic audio app.
- **Arcs below** — a water line under the flower. Quietest and most literal to the name,
  but it reads as a shadow or a base, not as projection.
- **Arcs above** — real projection, but the flower has to shrink and drop to make headroom,
  and a stem under arcs looks like a plant being watered.
- **Arcs above and below** — flower inside the ripple field. Four strokes is too many below
  32px.

Full concentric circles won. They match the landing animation literally, they match the
name (a _remanso_ is a still pool), and closed rings survive downscaling better than arcs,
whose endpoints blur into nothing.

## How it is built

Two sources, one composition:

- **`scripts/icons/flower.mjs`** — a flat vector redraw of the red ginger: nine bract
  shapes up a spike, two leaves, a stem. Authored in a 100-unit grid, self-centred. Used
  at 64px and below.
- **`public/mark.png`** — the untouched watercolour. Used at 180px and up, where its
  texture still reads. It has no rings baked in; the landing page adds its own.
- **`scripts/build-icons.mjs`** — draws two concentric rings in brand pink `#e36598`
  around whichever source, at a 64-unit grid, and writes every file in `public/`.

Run `pnpm icons` and commit the output. Nothing regenerates at build time.

## Per-size tuning, and why it is not optional

One geometry does not survive every size:

| Size    | Rings                     | Stroke | Flower                                              |
| ------- | ------------------------- | ------ | --------------------------------------------------- |
| ≥ 96px  | 2, at 0.55 / 0.28 opacity | 2.2    | watercolour (≥180px) or vector                      |
| 24–95px | 2, at 0.8 / 0.45 opacity  | 2.8    | vector, two-tone pinks, no midribs                  |
| < 24px  | 1, at r 26, full opacity  | 4.5    | vector, grown into the space the single ring leaves |

Two pale rings at 16px antialias into grey fuzz and the icon stops being pink. A 3-unit
stroke is 0.75px at 16px — it lands across two pixel rows at half strength, so the small
tier uses 4.5 to sit on a whole pixel. The four-step pink ramp collapses into one smudge
below 48px, so the small tier drops to two tones and deletes the leaf midribs.

**`sharpsToIco` must not be given a `sizes` option.** It resizes one render to every size
— picking the next render _larger_ than the target — which silently threw away all of the
above and shipped three scalings of the 16px drawing. Pass the three sharps and let each
one land at its native size.

## Files

Generated into `public/`: `favicon.ico` (16/32/48), `favicon.svg`, `masked-icon.svg`,
`pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `apple-touch-icon.png`,
`apple-touch-icon-180x180.png`, `maskable-icon-512x512.png`, `monochromeicon.png`.

Two of those need care:

- **`apple-touch-icon*`** is opaque `#fdfcfa`, because iOS composites the home-screen icon
  on black and a transparent one comes out as a flower in a void.
- **`maskable-icon-512x512.png`** is scaled to 0.82. Maskable icons get cropped to a circle
  80% of the canvas wide; the outer ring plus its stroke reaches 47.8% of the width, which
  is outside that. 0.82 pulls it in.

`masked-icon.png` was deleted. Safari's `rel="mask-icon"` wants an SVG, so it is now
`masked-icon.svg` — the same drawing in solid black.
