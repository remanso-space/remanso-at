// Regenerates every icon in public/ from the flat vector redraw in scripts/icons/flower.mjs
// (small sizes) and public/mark.png (180px and up).
//
// Run with `pnpm icons`. Committed output — this is not part of the build.

import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import ico from "sharp-ico"
import { COLOURS, COLOURS_SMALL, FLOWER_RADIUS, flowerMarkup } from "./icons/flower.mjs"

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url))
const MARK = `${PUBLIC}mark.png`

const PINK = "#e36598"
const PAPER = "#fdfcfa"

// Everything is authored in a 64-unit grid. The outer ring plus half its stroke
// has to clear the canvas edge, which is what caps its radius just under 32.
const GRID = 64

/**
 * Ripples re-tuned per size. Two pale rings are right at 512px and turn to grey
 * fuzz at 16px, where a single firm ring reads as a ripple and two do not.
 */
function ringsFor(px) {
  if (px >= 96) {
    return {
      stroke: 2.2,
      rings: [
        { r: 23, opacity: 0.55 },
        { r: 29.5, opacity: 0.28 },
      ],
    }
  }
  if (px >= 24) {
    return {
      stroke: 2.8,
      rings: [
        { r: 23, opacity: 0.8 },
        { r: 29.5, opacity: 0.45 },
      ],
    }
  }
  // 3 units of the 64-grid is 0.75px at 16px, which antialiases into two grey
  // half-rows. 4.5 lands on a full pixel and the ring stays pink.
  return { stroke: 4.5, rings: [{ r: 26, opacity: 1 }] }
}

function ringsMarkup(px, colour, opaque = false) {
  const { stroke, rings } = ringsFor(px)
  return rings
    .map(
      (ring) =>
        `<circle cx="32" cy="32" r="${ring.r}" fill="none" stroke="${colour}"` +
        ` stroke-width="${stroke}" opacity="${opaque ? 1 : ring.opacity}" />`,
    )
    .join("")
}

/**
 * `scale` shrinks the composition toward the centre, keeping a maskable icon in its safe
 * circle.
 */
function vectorIcon({ px, mono = false, scale = 1 }) {
  const small = px < 48
  const colour = mono ? "#000" : PINK
  const palette = small ? COLOURS_SMALL : COLOURS
  const colourOf = (role) => (mono ? "#000" : palette[role])
  // Fit the drawing inside the innermost ring with a little air: its own radius
  // is FLOWER_RADIUS in a 100-unit grid. The single small-size ring sits further
  // out, so the flower grows into the space it leaves.
  const { stroke, rings } = ringsFor(px)
  const clearance = Math.min(...rings.map((r) => r.r)) - stroke / 2 - 1
  const size = (clearance / FLOWER_RADIUS) * 100
  const inset = (GRID - size) / 2
  const body =
    `<g stroke-linecap="round">${ringsMarkup(px, colour, mono)}</g>` +
    `<g transform="translate(${inset} ${inset}) scale(${size / 100})">` +
    `${flowerMarkup(colourOf, small ? ["midrib"] : [])}</g>`
  const wrapped =
    scale === 1
      ? body
      : `<g transform="translate(${(GRID * (1 - scale)) / 2} ${(GRID * (1 - scale)) / 2}) scale(${scale})">${body}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">${wrapped}</svg>`
}

function renderVector(px, opts = {}) {
  return sharp(Buffer.from(vectorIcon({ px, ...opts })), {
    density: (px / GRID) * 72 * 4,
  })
    .resize(px, px)
    .png()
}

/**
 * Watercolour icon: the untouched mark.png sized to match the vector drawing's
 * footprint, with the same rings rendered underneath it.
 */
async function renderRaster(px, { background, scale = 1 } = {}) {
  const inner = Math.round(px * scale)
  const rings =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">` +
    `<g stroke-linecap="round">${ringsMarkup(inner, PINK)}</g></svg>`
  const ringsPng = await sharp(Buffer.from(rings), { density: (inner / GRID) * 72 * 4 })
    .resize(inner, inner)
    .png()
    .toBuffer()

  // mark.png carries its own transparent padding, so its box is wider than the
  // drawing inside it. 53/64 lands the flower at the same visual size as the vector.
  const box = Math.round(inner * (53 / GRID))
  const flower = await sharp(MARK).resize(box, box, { fit: "contain" }).png().toBuffer()
  const offset = Math.round((inner - box) / 2)

  const composed = await sharp({
    create: {
      width: inner,
      height: inner,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: ringsPng, top: 0, left: 0 },
      { input: flower, top: offset, left: offset },
    ])
    .png()
    .toBuffer()

  if (inner === px && !background) return sharp(composed).png()
  const pad = Math.round((px - inner) / 2)
  return sharp({
    create: {
      width: px,
      height: px,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: composed, top: pad, left: pad }])
    .png()
}

async function write(name, image) {
  await image.toFile(`${PUBLIC}${name}`)
  console.log(`  ${name}`)
}

console.log("vector (flat redraw)")
// A scalable favicon is only ever shown in a tab, so it is tuned for 32px rather
// than for the size a vector could in principle be drawn at.
await writeFile(`${PUBLIC}favicon.svg`, vectorIcon({ px: 32 }))
console.log("  favicon.svg")
await writeFile(`${PUBLIC}masked-icon.svg`, vectorIcon({ px: 32, mono: true }))
console.log("  masked-icon.svg")
await write("pwa-64x64.png", renderVector(64))
await write("monochromeicon.png", renderVector(1024, { mono: true }))

// 16/32/48 all come from the vector; the .ico is what Windows and older browsers
// read. No `sizes` option here on purpose — it would rescale one render to every
// size and throw away the per-size ring tuning.
await ico.sharpsToIco(
  [renderVector(16), renderVector(32), renderVector(48)],
  `${PUBLIC}favicon.ico`,
)
console.log("  favicon.ico")

console.log("watercolour (mark.png)")
// iOS composites the home-screen icon on black, so this one is not transparent.
const apple = { r: 253, g: 252, b: 250, alpha: 1 }
await write("apple-touch-icon.png", await renderRaster(180, { background: apple }))
await write("apple-touch-icon-180x180.png", await renderRaster(180, { background: apple }))
await write("pwa-192x192.png", await renderRaster(192))
await write("pwa-512x512.png", await renderRaster(512))
// Maskable icons get cropped to a circle 80% of the canvas wide. The outer ring
// plus its stroke reaches 47.8% of the width, so it needs 0.82 to sit inside the
// safe zone; the background fills whatever corners the crop keeps.
await write(
  "maskable-icon-512x512.png",
  await renderRaster(512, { background: apple, scale: 0.82 }),
)

console.log(`\n${PAPER} paper, ${PINK} pink — done.`)
