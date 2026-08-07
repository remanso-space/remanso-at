import { createApp } from "vue"
import { atprotoLoginPlugin } from "vue-atproto-login"
import "vue-atproto-login/style.css"
import "./style.css"
import App from "./App.vue"
import { stripCallbackParams } from "./modules/atproto/stripCallbackParams"
import { router } from "./router"

createApp(App)
  .use(router)
  .use(
    atprotoLoginPlugin({
      // `client_id` *is* the client-metadata URL, so https://remanso.at/client-metadata.json
      // is a distinct OAuth client from remanso.space's: separate consent, refresh token and
      // DPoP keypair, and no session shared across the two origins. Two sign-ins is the design.
      clientId: "https://remanso.at/client-metadata.json",
      // The library's own `import.meta.env` was frozen when it was built, so the dev flag has
      // to come from ours. In dev it builds a loopback client id from the origin instead.
      dev: import.meta.env.DEV,
      // A remanso.space cross-link arrives as /?handle=alice.bsky.social: seed the box and
      // start the redirect straight away, with the param stripped so it is never bookmarked.
      autoSignInFromQuery: "handle",
      stripCallbackParams: stripCallbackParams(router),
    }),
  )
  .mount("#app")
