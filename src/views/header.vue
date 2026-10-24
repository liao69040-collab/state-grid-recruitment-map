<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

const nowText = ref("");
let timer: ReturnType<typeof setInterval> | undefined;

const updateClock = () => {
  nowText.value = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
};

const toggleFullscreen = async () => {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
};

const navigateDashboard = (target: "national" | "school" | "company" | "calendar" | "sources") => {
  window.dispatchEvent(new CustomEvent("dashboard:navigate", { detail: target }));
};

onMounted(() => {
  updateClock();
  timer = setInterval(updateClock, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <div>
        <h1>全国电网招聘数据地图</h1>
        <p>全国总览 · 湖北省深度钻取</p>
      </div>
    </div>

    <nav class="main-nav" aria-label="主导航">
      <button type="button" @click="navigateDashboard('national')">全国总览</button>
      <button type="button" @click="navigateDashboard('school')">学校库</button>
      <button type="button" @click="navigateDashboard('company')">国网公司库</button>
      <button type="button" @click="navigateDashboard('calendar')">招聘日历</button>
      <button type="button" @click="navigateDashboard('sources')">来源中心</button>
    </nav>

    <div class="header-meta">
      <div class="cohort-chip"><span></span>数据届次：2026届</div>
      <div class="clock">
        <small>北京时间</small>
        <strong>{{ nowText }}</strong>
      </div>
      <button class="fullscreen-button" type="button" title="切换全屏" @click="toggleFullscreen">全屏</button>
    </div>
  </header>
</template>

<style scoped lang="scss">
.app-header {
  height: 64px;
  display: grid;
  grid-template-columns: minmax(470px, 1.15fr) auto minmax(420px, 1fr);
  align-items: center;
  gap: 20px;
  margin-bottom: 10px;
  padding: 0 18px;
  box-sizing: border-box;
  color: #173f5c;
  border: 1px solid rgba(202, 228, 244, 0.96);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 14px 36px rgba(46, 118, 166, 0.08);
}

.brand {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 11px;

  h1,
  p {
    margin: 0;
  }

  h1 {
    overflow: hidden;
    font-size: 19px;
    letter-spacing: 0.4px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  p {
    margin-top: 3px;
    color: #7c9aaf;
    font-size: 10px;
    letter-spacing: 1.2px;
  }
}

.main-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 100%;

  button {
    position: relative;
    height: 100%;
    padding: 0 14px;
    color: #6e8ba0;
    font-size: 12px;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  button.active {
    color: #246f9f;
    font-weight: 800;
  }

  button.active::after {
    position: absolute;
    right: 14px;
    bottom: 8px;
    left: 14px;
    height: 3px;
    border-radius: 99px;
    background: linear-gradient(90deg, #77c5ef, #318eca);
    content: "";
  }

}

.header-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
}

.cohort-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  color: #2e729e;
  font-size: 10px;
  font-weight: 700;
  border-radius: 99px;
  background: #eaf6fd;

  span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #3b9bd4;
    box-shadow: 0 0 0 4px rgba(59, 155, 212, 0.12);
  }
}

.clock {
  text-align: right;

  small,
  strong {
    display: block;
  }

  small {
    margin-bottom: 2px;
    color: #8ca4b4;
    font-size: 8px;
  }

  strong {
    color: #345d77;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
}

.fullscreen-button {
  display: grid;
  place-items: center;
  width: 56px;
  height: 44px;
  color: #317eae;
  border: 1px solid #c8e1f1;
  border-radius: 10px;
  background: #f2f9fd;
  cursor: pointer;
}
</style>
