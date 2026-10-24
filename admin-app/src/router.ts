import { createRouter, createWebHistory } from "vue-router";
import { adminAuth } from "@/lib/auth";

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/login", name: "login", component: () => import("@/views/LoginView.vue"), meta: { public: true } },
    {
      path: "/",
      component: () => import("@/components/AppShell.vue"),
      children: [
        { path: "", name: "dashboard", component: () => import("@/views/DashboardView.vue") },
        { path: "users", name: "users", component: () => import("@/views/UsersView.vue") },
        { path: "grid-query", name: "grid-query", component: () => import("@/views/GridQueryView.vue") },
        { path: "data/:resource", name: "resource", component: () => import("@/views/ResourceView.vue") },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  if (!adminAuth.state.ready) await adminAuth.bootstrap();
  if (to.meta.public) {
    if (to.name === "login" && adminAuth.state.authenticated) return { name: "dashboard" };
    return true;
  }
  if (!adminAuth.state.authenticated) return { name: "login", query: { redirect: to.fullPath } };
  return true;
});
