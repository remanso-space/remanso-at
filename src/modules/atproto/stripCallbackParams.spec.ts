import { describe, expect, it, vi } from "vitest"
import type { Router } from "vue-router"

import { stripCallbackParams } from "./stripCallbackParams"

const fakeRouter = () => {
  const replace = vi.fn(async () => undefined)
  return { router: { replace } as unknown as Router, replace }
}

describe("stripCallbackParams", () => {
  it("drops the three OAuth params the PDS redirected back with", async () => {
    const { router, replace } = fakeRouter()

    await stripCallbackParams(router)(
      new URL("https://remanso.at/?code=abc&state=xyz&iss=https%3A%2F%2Fbsky.social"),
    )

    expect(replace).toHaveBeenCalledWith({ path: "/", query: {} })
  })

  it("keeps the app's own params and the path", async () => {
    const { router, replace } = fakeRouter()

    await stripCallbackParams(router)(new URL("https://remanso.at/listen?code=abc&all=1"))

    expect(replace).toHaveBeenCalledWith({ path: "/listen", query: { all: "1" } })
  })

  it("rewrites even when there is nothing to strip, so the caller stays simple", async () => {
    const { router, replace } = fakeRouter()

    await stripCallbackParams(router)(new URL("https://remanso.at/studio"))

    expect(replace).toHaveBeenCalledWith({ path: "/studio", query: {} })
  })
})
