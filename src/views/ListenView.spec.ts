import { mount, type VueWrapper } from "@vue/test-utils"
import { ref } from "vue"
import { createMemoryHistory, createRouter, type Router } from "vue-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ActorSuggestion } from "../modules/atproto/searchActors"

// The view's data sources are all network. Mocked at the module edge so the test is about
// the search box: what it asks for, what it shows, and where picking a row navigates.
const searchActors = vi.fn<(query: string) => Promise<ActorSuggestion[]>>()

vi.mock("../modules/atproto/searchActors", () => ({
  searchActors: (query: string) => searchActors(query),
}))

vi.mock("../modules/atproto/listAllRecordings", () => ({
  listAllRecordings: vi.fn(async () => ({ ok: true, recordings: [], cursor: undefined })),
}))

vi.mock("../modules/atproto/listRecordings", () => ({
  listRecordings: vi.fn(async ({ actor }: { actor: string }) => ({
    ok: true,
    actor: { did: `did:plc:${actor}`, handle: actor, pds: "https://pds.example.com" },
    recordings: [],
    cursor: undefined,
  })),
}))

// Imported by the view but unused on the everyone feed; stubbed to keep the OAuth client out.
vi.mock("../modules/atproto/deleteRecording", () => ({ deleteRecording: vi.fn() }))

// Signed out, and resolved: the view renders the everyone feed. Mocking the library keeps
// its OAuth client — and the configuration it would demand — out of a component test.
vi.mock("vue-atproto-login", () => ({
  useAtprotoLogin: () => ({
    did: ref(""),
    handle: ref(""),
    displayName: ref(null),
    avatar: ref(null),
    pds: ref(null),
    prefillHandle: ref(""),
    isLoggedIn: ref(false),
    isReady: ref(true),
    signIn: vi.fn(),
    signOut: vi.fn(),
    refresh: vi.fn(),
    getSession: vi.fn(async () => null),
  }),
}))

const ListenView = (await import("./ListenView.vue")).default

let wrapper: VueWrapper | null = null
let router: Router

const SUGGESTIONS: ActorSuggestion[] = [
  { did: "did:plc:aaa", handle: "ana.example.com", displayName: "Ana" },
  { did: "did:plc:bbb", handle: "bo.example.com" },
]

const mountListen = async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<p />" } },
      { path: "/listen", component: ListenView },
    ],
  })
  await router.push("/listen?all=1")
  await router.isReady()
  wrapper = mount(ListenView, { global: { plugins: [router] } })
  await vi.waitFor(() => expect(wrapper!.find(".search-input").exists()).toBe(true))
  return wrapper
}

/** Type into the box and let the debounce fire. */
const type = async (text: string) => {
  const input = wrapper!.find(".search-input")
  await input.setValue(text)
  await vi.advanceTimersByTimeAsync(200)
  await wrapper!.vm.$nextTick()
}

const rows = () => wrapper!.findAll(".suggestion")
const activeRow = () => wrapper!.find(".suggestion.active")

beforeEach(() => {
  vi.useFakeTimers()
  searchActors.mockReset()
  searchActors.mockResolvedValue(SUGGESTIONS)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
})

describe("ListenView handle search", () => {
  it("suggests handles from the network as you type", async () => {
    await mountListen()
    await type("an")

    expect(searchActors).toHaveBeenCalledWith("an")
    expect(rows()).toHaveLength(2)
    expect(rows()[0].text()).toContain("ana.example.com")
    expect(rows()[0].text()).toContain("Ana")
  })

  it("debounces to one lookup per burst of keystrokes", async () => {
    await mountListen()
    const input = wrapper!.find(".search-input")
    await input.setValue("a")
    await input.setValue("an")
    await input.setValue("ana")
    await vi.advanceTimersByTimeAsync(200)

    expect(searchActors).toHaveBeenCalledTimes(1)
    expect(searchActors).toHaveBeenCalledWith("ana")
  })

  it("navigates to the handle of the row you click", async () => {
    await mountListen()
    await type("bo")
    await rows()[1].trigger("mousedown")
    await vi.waitFor(() => expect(router.currentRoute.value.query.handle).toBe("bo.example.com"))
    expect(rows()).toHaveLength(0)
  })

  it("walks the rows with the arrow keys and takes the highlighted one on Enter", async () => {
    await mountListen()
    await type("an")
    const input = wrapper!.find(".search-input")

    await input.trigger("keydown", { key: "ArrowDown" })
    expect(activeRow().text()).toContain("ana.example.com")
    await input.trigger("keydown", { key: "ArrowDown" })
    expect(activeRow().text()).toContain("bo.example.com")
    // Past the last row is "nothing highlighted", so what you typed is still reachable.
    await input.trigger("keydown", { key: "ArrowDown" })
    expect(activeRow().exists()).toBe(false)
    await input.trigger("keydown", { key: "ArrowUp" })
    expect(activeRow().text()).toContain("bo.example.com")

    await wrapper!.find("form").trigger("submit")
    await vi.waitFor(() => expect(router.currentRoute.value.query.handle).toBe("bo.example.com"))
  })

  it("submits what was typed when no row is highlighted", async () => {
    await mountListen()
    await type("nobody.example.com")
    await wrapper!.find("form").trigger("submit")
    await vi.waitFor(() =>
      expect(router.currentRoute.value.query.handle).toBe("nobody.example.com"),
    )
  })

  it("falls back to the everyone feed on an empty submit", async () => {
    await mountListen()
    await type("ana.example.com")
    await wrapper!.find(".search-input").setValue("")
    await wrapper!.find("form").trigger("submit")
    await vi.waitFor(() => expect(router.currentRoute.value.query.all).toBe("1"))
  })

  it("keeps the button inside the field so the two read as one control", async () => {
    await mountListen()
    const button = wrapper!.find(".search-field > .search-go")
    expect(button.exists()).toBe(true)
    expect(button.attributes("type")).toBe("submit")
    // Suffix, not prefix: the input comes first in the flex row.
    const children = [...wrapper!.find(".search-field").element.children].map((el) => el.className)
    expect(children.indexOf("search-input mono")).toBeLessThan(children.indexOf("search-go"))
  })

  it("closes the list on Escape without navigating", async () => {
    await mountListen()
    await type("an")
    await wrapper!.find(".search-input").trigger("keydown", { key: "Escape" })
    expect(rows()).toHaveLength(0)
    expect(router.currentRoute.value.query.handle).toBeUndefined()
  })

  it("asks for nothing and shows nothing once the box is cleared", async () => {
    await mountListen()
    await type("an")
    expect(rows()).toHaveLength(2)

    searchActors.mockClear()
    await type("")
    expect(searchActors).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(0)
  })
})
