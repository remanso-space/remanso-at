import { createRouter, createWebHistory } from "vue-router"
import type { RouteRecordRaw } from "vue-router"

import HomeView from "./views/HomeView.vue"

// Deep links stay anonymous — no navigation guards. /studio renders a signed-out
// pitch rather than redirecting, so a shared link never bounces to sign-in.
const routes: RouteRecordRaw[] = [
  { path: "/", name: "home", component: HomeView },
  {
    path: "/studio",
    name: "studio",
    component: () => import("./views/StudioView.vue"),
  },
  {
    path: "/listen",
    name: "listen",
    component: () => import("./views/ListenView.vue"),
  },
  // Unlisted scratch page for choosing the favicon. No nav entry on purpose.
  {
    path: "/favicon-lab",
    name: "favicon-lab",
    component: () => import("./views/FaviconLabView.vue"),
  },
  { path: "/:catchAll(.*)", redirect: "/" },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})
