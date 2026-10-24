<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { resources } from "@/config/resources";
import { navigationGroups } from "@/config/navigation";
import { adminAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import AppIcon from "@/components/AppIcon.vue";

const route = useRoute();
const router = useRouter();
const sidebarOpen = ref(false);
const loggingOut = ref(false);

// A 401 can arrive without route navigation. Remove already-rendered private
// content immediately, then return to login; transient network errors do not
// change authenticated state and therefore cannot trigger this boundary.
watch(() => adminAuth.state.authenticated, authenticated => {
  if (!authenticated && route.name !== "login") {
    void router.replace({ name: "login", query: { redirect: route.fullPath } });
  }
}, { flush: "sync" });

const navGroups = navigationGroups.map(group => ({ ...group, links: [...group.links, ...group.keys.map(key => resources.find(item => item.key === key)!).filter(Boolean).map(resource => ({ label: resource.title.replace("管理", ""), path: `/data/${resource.key}`, icon: resource.icon }))] }));
const activeLink = (path: string) => {
  const [pathname, search] = path.split("?");
  return route.path === pathname && (!search || (route.query.tab || "facts") === new URLSearchParams(search).get("tab"));
};

const currentResource = computed(() => resources.find((item) => item.key === route.params.resource));
const pageTitle = computed(() => {
  if (route.name === "dashboard") return "管理总览";
  if (route.name === "users") return "用户授权管理";
  if (route.name === "grid-query") return "电网信息与完整院校榜";
  return currentResource.value?.title || "数据管理";
});

const closeSidebar = () => {
  sidebarOpen.value = false;
};

const signOut = async () => {
  loggingOut.value = true;
  try {
    await adminAuth.logout();
    await router.replace({ name: "login" });
  } catch {
    toast.error("退出请求失败，本地会话已清除。请关闭页面。 ");
    await router.replace({ name: "login" });
  } finally {
    loggingOut.value = false;
  }
};

const publicSite = import.meta.env.VITE_PUBLIC_SITE_URL || "https://ai-education.cn";
</script>

<template>
  <div v-if="adminAuth.state.authenticated" class="app-shell">
    <button
      v-if="sidebarOpen"
      class="sidebar-scrim"
      type="button"
      aria-label="关闭导航"
      @click="closeSidebar"
    ></button>

    <aside class="sidebar" :class="{ 'is-open': sidebarOpen }">
      <div class="brand-block">
        <div class="brand-mark" aria-hidden="true">
          <AppIcon name="DataLine" :size="22" />
        </div>
        <div>
          <strong>电网招聘数据管理台</strong>
          <small>国网 · 南网 · 独立管理</small>
        </div>
      </div>

      <nav class="sidebar-nav" aria-label="后台导航">
        <RouterLink to="/" class="nav-link" exact-active-class="is-active" @click="closeSidebar">
          <span class="nav-icon"><AppIcon name="Grid" :size="15" /></span><span>管理总览</span>
        </RouterLink>

        <section v-for="group in navGroups" :key="group.label" class="nav-group">
          <h2 class="nav-heading">{{ group.label }}</h2>
          <RouterLink v-for="link in group.links" :key="link.path" :to="link.path" class="nav-link" active-class="" :class="{ 'is-active': activeLink(link.path) }" @click="closeSidebar">
            <span class="nav-icon"><AppIcon :name="link.icon" :size="15" /></span><span>{{ link.label }}</span>
          </RouterLink>
        </section>
      </nav>

      <div class="sidebar-footer">
        <a class="public-site-link" :href="publicSite" target="_blank" rel="noreferrer">
          <span>打开数据地图</span><AppIcon name="TopRight" :size="14" />
        </a>
        <button class="button secondary compact sidebar-signout" type="button" :disabled="loggingOut" @click="signOut">{{ loggingOut ? '退出中…' : '退出登录' }}</button>
        <div class="data-boundary">
          <span class="status-dot"></span>
          <div><b>数据边界已启用</b><small>来源、年份、批次全程留痕</small></div>
        </div>
      </div>
    </aside>

    <div class="shell-main">
      <header class="topbar">
        <div class="topbar-left">
          <button type="button" class="mobile-menu" aria-label="打开导航" @click="sidebarOpen = true">
            <AppIcon name="Menu" :size="19" />
          </button>
          <div>
            <span class="breadcrumb">独立后台 / {{ pageTitle }}</span>
            <h1>{{ pageTitle }}</h1>
          </div>
        </div>
        <div class="topbar-actions">
          <div class="admin-chip">
            <span class="admin-avatar"><AppIcon name="User" :size="17" /></span>
            <div>
              <b>{{ adminAuth.state.admin?.displayName || adminAuth.state.admin?.username || "超级管理员" }}</b>
              <small>超级管理员</small>
            </div>
          </div>
          <button type="button" class="button secondary compact" :disabled="loggingOut" @click="signOut">
            <AppIcon name="SwitchButton" :size="14" />
            {{ loggingOut ? "退出中…" : "退出登录" }}
          </button>
        </div>
      </header>

      <main class="workspace">
        <RouterView />
      </main>
    </div>
  </div>
</template>
