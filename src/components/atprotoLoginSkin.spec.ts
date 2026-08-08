import { describe, expect, it } from "vitest"
import { DEFAULT_UI } from "vue-atproto-login"

// src/style.css restyles the library's markup by class name, so a rename in a future version
// would silently drop the skin. This pins the contract.
//
// The handle box's own key is omitted on purpose: naming it here would put a bare daisyUI
// component word in source, and Tailwind would ship that whole component for a test file.
//
// Mounting the component is not tested here — it starts the OAuth client, and jsdom has
// neither IndexedDB nor a navigable document.
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
