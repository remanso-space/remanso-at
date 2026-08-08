// Shared measurements for the *.browser.spec.ts files, which exist to answer the one
// question jsdom cannot: does this fit on a phone, and can a thumb hit it.

/** An iPhone 14/15 in portrait — the narrow end the studio has to survive. */
export const PHONE_WIDTH = 390

/**
 * The smallest target Apple's HIG asks for and WCAG 2.2 AA calls comfortable (its floor is
 * 24 px). Under this, a control on a phone is a miss as often as a hit.
 */
export const MIN_TAP_TARGET = 44

/**
 * WCAG 2.2 AA's own floor. A control may sit at this size only where a full-size
 * equivalent exists elsewhere on the page — the timeline's per-slot × against the music
 * panel's "Remove" — which is the standard's equivalence exception, not a lower bar.
 */
export const WCAG_MIN_TARGET = 24

/** Renders into a phone-width column, as a real page column would. */
export const asPhoneColumn = () => {
  document.body.style.width = `${PHONE_WIDTH}px`
  document.body.style.margin = "0"
}

/** Every element painting past `limit`, named so a failure says which one ran off. */
export const overflowing = (root: Element, limit: number = window.innerWidth): string[] =>
  [...root.querySelectorAll("*")]
    // Half a pixel of slack: sub-pixel layout rounds, and no thumb misses by 0.4 px.
    .filter((el) => el.getBoundingClientRect().right > limit + 0.5)
    .map((el) => `${el.tagName.toLowerCase()}.${el.className || "-"}`)

/** Every interactive control smaller than `min` in either direction, with its box. */
export const undersizedTargets = (root: Element, min: number = MIN_TAP_TARGET): string[] =>
  [...root.querySelectorAll("button, select, input, a[href]")]
    // A checkbox inside a label is tapped anywhere on the label, so the label is the
    // target — measuring the 13 px box alone would report a control that is fine.
    .map((el) => ({ el, box: (el.closest("label") ?? el).getBoundingClientRect() }))
    // A control the layout has hidden (a collapsed panel) measures 0 and is not a target.
    .filter(({ box }) => box.height > 0 && (box.height < min || box.width < min))
    .map(
      ({ el, box }) =>
        `${el.textContent?.trim() || el.className}: ${Math.round(box.width)}×${Math.round(box.height)}px`,
    )
