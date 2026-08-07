import { describe, expect, it } from "vitest"
import { DEFAULT_UI } from "vue-atproto-login"

// The nav's sign-in is vue-atproto-login's own component, so its behaviour is the library's
// to test. What is ours is the paper skin: src/style.css restyles the library's markup by
// class name, and a rename in a future version would drop the skin with nothing failing —
// the box would simply go back to Bluesky blue. This is the contract that makes it loud.
//
// The handle box's own key is the one omission: naming it here would put a bare daisyUI
// component word in source, and Tailwind would ship that whole component for a test file.
//
// Mounting the component is deliberately not tested here: it starts the OAuth client, and
// jsdom has neither IndexedDB nor a navigable document, so the assertions would be about the
// environment rather than the app. The real sign-in path is a browser check.
describe("the paper skin over vue-atproto-login", () => {
  it("targets the class names the library still renders", () => {
    expect(DEFAULT_UI.root).toBe("atp-root")
    expect(DEFAULT_UI.form).toBe("atp-form")
    expect(DEFAULT_UI.loading).toBe("atp-loading")
    expect(DEFAULT_UI.signedIn).toBe("atp-signed-in")
    expect(DEFAULT_UI.handle).toBe("atp-handle")
    expect(DEFAULT_UI.button).toBe("atp-button")
  })
})
