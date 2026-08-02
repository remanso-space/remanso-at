# Icons

Tabler outline icons, dropped here as needed: https://tabler.io/icons

Keep `stroke="currentColor"` so the icon follows the surrounding text colour.

- Static colour: `<img src="@/assets/icons/foo.svg" alt="" class="size-5" />`
- Follows `currentColor`: paste the SVG inline as a Vue component (see
  `src/components/RippleMark.vue`)

`public/favicon.svg` is the `ripple` icon with `currentColor` replaced by the brand pink
`#e36598`, since a favicon has no surrounding text to inherit from.
