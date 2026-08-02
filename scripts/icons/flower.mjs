// Flat vector redraw of the red-ginger mark, for icon sizes where the watercolour
// `public/mark.png` turns to mush (16-64px). Authored in a 100x100 grid, centred:
// content spans x 15..85, y 14..86, so the drawing's own centre is (50, 50).
//
// The watercolour stays the mark everywhere it has room to breathe — the landing
// hero and the 180px-and-up icons. This is only the small-size stand-in.

/** @typedef {{ d: string, role: string, width?: number }} Shape */

/**
 * Stroked shapes carry `width` (in grid units); the rest are filled.
 * Order is paint order: stem, then bracts bottom-up, then leaves on top.
 * @type {Shape[]}
 */
export const SHAPES = [
  { d: "M49 57 L51 80", role: "stem", width: 4.5 },

  // Spike: pairs of bracts alternating left and right, each pair a little wider
  // and a little deeper in colour than the one above it.
  { d: "M49 54 Q36.7 50 36 40 Q45.1 41 49 54 Z", role: "bract4" },
  { d: "M49 58.5 Q61.4 54.5 62 44.5 Q52.9 45.5 49 58.5 Z", role: "bract4" },
  { d: "M49 45 Q37.1 41 36.5 31 Q45.3 32 49 45 Z", role: "bract3" },
  { d: "M49 49.5 Q60.9 45.5 61.5 35.5 Q52.8 36.5 49 49.5 Z", role: "bract3" },
  { d: "M49 36 Q39 32 38.5 22 Q45.9 23 49 36 Z", role: "bract2" },
  { d: "M49 40.5 Q59 36.5 59.5 26.5 Q52.2 27.5 49 40.5 Z", role: "bract2" },
  { d: "M49 27 Q41.4 23 41 13 Q46.6 14 49 27 Z", role: "bract1" },
  { d: "M49 31.5 Q56.6 27.5 57 17.5 Q51.4 18.5 49 31.5 Z", role: "bract1" },
  { d: "M49 24 Q44.5 16 49 8 Q53.5 16 49 24 Z", role: "bract1" },

  { d: "M46 62 Q30 47 15 50 Q28 60 46 62 Z", role: "leaf" },
  { d: "M52 62 Q69 45 85 53 Q70 62 52 62 Z", role: "leaf" },
  { d: "M45 61 Q31 53 16 50", role: "midrib", width: 1.4 },
  { d: "M53 61 Q69 52 84 53", role: "midrib", width: 1.4 },
]

/** The drawing sits 6 units high in its own coordinates; this recentres it. */
export const FLOWER_OFFSET_Y = 6

/** Half-width of the drawing measured from its centre, used to size it inside a ring. */
export const FLOWER_RADIUS = 37

export const COLOURS = {
  bract1: "#f7b3ca",
  bract2: "#f195b5",
  bract3: "#ea7ba4",
  bract4: "#e36598",
  leaf: "#6b8e4e",
  midrib: "#587a3f",
  stem: "#6b8e4e",
}

/**
 * Below ~48px the four-step pink ramp reads as one pale smudge and the midribs
 * are noise. Two tones and a darker leaf hold their shape instead.
 */
export const COLOURS_SMALL = {
  ...COLOURS,
  bract1: "#ea7ba4",
  bract2: "#ea7ba4",
  bract3: "#e36598",
  bract4: "#e36598",
  leaf: "#5f7f45",
}

/**
 * Render the flower's shapes as SVG markup.
 * @param {(role: string) => string} colourOf
 */
export function flowerMarkup(colourOf, skip = []) {
  const shapes = SHAPES.filter((s) => !skip.includes(s.role))
    .map((s) =>
      s.width
        ? `<path d="${s.d}" fill="none" stroke="${colourOf(s.role)}" stroke-width="${s.width}" stroke-linecap="round" />`
        : `<path d="${s.d}" fill="${colourOf(s.role)}" />`,
    )
    .join("")
  return `<g transform="translate(0 ${FLOWER_OFFSET_Y})">${shapes}</g>`
}
