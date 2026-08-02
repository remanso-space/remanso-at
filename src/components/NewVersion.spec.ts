import { mount, type VueWrapper } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { useRecordingState } from "../composables/useRecordingState"
import { needRefresh, offlineReady } from "../test/pwaRegisterStub"
import NewVersion from "./NewVersion.vue"

let wrapper: VueWrapper | null = null

// The toast teleports to body, so it is only reachable through the real document.
const mountAt = (search: string) => {
  wrapper?.unmount()
  window.history.replaceState({}, "", search)
  wrapper = mount(NewVersion, { attachTo: document.body })
  return wrapper
}

const toast = () => document.body.querySelector(".toast")

beforeEach(() => {
  offlineReady.value = false
  needRefresh.value = false
  useRecordingState().setRecording(false)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe("NewVersion", () => {
  it("stays hidden when the service worker has nothing to say", () => {
    mountAt("/")
    expect(toast()).toBeNull()
  })

  it("shows the update prompt when a fresh build is waiting", async () => {
    mountAt("/")
    needRefresh.value = true
    await Promise.resolve()
    expect(toast()?.textContent).toContain("A fresh build is available.")
  })

  // The reason ?toast= exists: neither state can be triggered on demand otherwise.
  it("renders the update prompt on demand via ?toast=new-version", () => {
    mountAt("/studio?toast=new-version")
    expect(toast()?.textContent).toContain("new version")
    expect(document.body.querySelector(".toast-btn-primary")?.textContent).toContain("Reload")
  })

  it("renders the offline notice on demand via ?toast=offline-ready", () => {
    mountAt("/?toast=offline-ready")
    expect(toast()?.textContent).toContain("Ready to work offline.")
  })

  it("holds a real prompt back mid-recording, but not a requested preview", async () => {
    useRecordingState().setRecording(true)

    mountAt("/")
    needRefresh.value = true
    await Promise.resolve()
    expect(toast()).toBeNull()

    mountAt("/?toast=new-version")
    expect(toast()).not.toBeNull()
  })
})
