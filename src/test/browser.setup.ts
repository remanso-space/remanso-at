// The browser-mode harness serves its own blank page, so nothing the app's index.html
// does applies. The stylesheet is the whole point of these tests — every --hw-* token and
// every @media rule lives in it — so it is loaded here for all of them.
import "../style.css"

// index.html paints the page background; the harness page is transparent white otherwise.
document.documentElement.style.background = "var(--hw-paper)"

// The harness mounts into a container that is `display: block; width: 100%` by default,
// which is what a real page gives a top-level section. Nothing to override — but the body
// margin is not zeroed by the harness, and 8px of it changes every width assertion.
document.body.style.margin = "0"
