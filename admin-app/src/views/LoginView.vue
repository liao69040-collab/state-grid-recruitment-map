<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "@/lib/api";
import { adminAuth } from "@/lib/auth";
import AppIcon from "@/components/AppIcon.vue";

const router = useRouter();
const route = useRoute();
const username = ref("");
const password = ref("");
const showPassword = ref(false);
const errorMessage = ref("");
const submitting = ref(false);

const canSubmit = computed(() => username.value.trim().length > 0 && password.value.length > 0 && !submitting.value);

const submit = async () => {
  errorMessage.value = "";
  submitting.value = true;
  try {
    await adminAuth.login(username.value.trim(), password.value);
    const destination = typeof route.query.redirect === "string" && route.query.redirect.startsWith("/")
      ? route.query.redirect
      : "/";
    await router.replace(destination);
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) {
      errorMessage.value = "尝试次数过多，请稍后再试。";
    } else if (error instanceof ApiError && error.status === 401) {
      errorMessage.value = "账号或密码不正确。";
    } else {
      errorMessage.value = error instanceof Error ? error.message : "登录失败，请稍后再试。";
    }
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <main class="login-page">
    <div class="login-grid" aria-hidden="true"></div>
    <div class="login-orb orb-one" aria-hidden="true"></div>
    <div class="login-orb orb-two" aria-hidden="true"></div>

    <section class="login-card">
      <div class="login-intro">
        <div class="login-brand">
          <div class="brand-mark large" aria-hidden="true"><AppIcon name="DataLine" :size="26" /></div>
          <div><strong>电网招聘数据管理台</strong><small>国网 · 南网 · 独立管理</small></div>
        </div>
        <span class="eyebrow">独立后台 · 数据与权限</span>
        <h1>一处管理账号与<br />全站招聘数据</h1>
        <p>独立后台仅供授权管理员使用。学校、单位、批次、时间线、指标与来源均通过服务端数据库维护并保留审计记录。</p>
        <ul class="login-assurances">
          <li><span>01</span><div><b>账号权限独立</b><small>手机号码授权、启停和密码重置集中处理</small></div></li>
          <li><span>02</span><div><b>数据来源可追溯</b><small>年份、批次、单位与官方来源字段不丢失</small></div></li>
          <li><span>03</span><div><b>修改全程留痕</b><small>管理员操作写入不可编辑的审计日志</small></div></li>
        </ul>
      </div>

      <div class="login-form-panel">
        <div class="secure-badge"><span class="status-dot"></span> 安全连接 · 管理员会话</div>
        <span class="eyebrow">超级管理员登录</span>
        <h2>超级管理员登录</h2>
        <p>请输入服务器配置的管理员账号与密码。</p>

        <form @submit.prevent="submit">
          <label class="login-field">
            <span>管理员账号</span>
            <div class="input-shell">
              <span aria-hidden="true"><AppIcon name="User" :size="14" /></span>
              <input v-model="username" type="text" autocomplete="username" placeholder="请输入管理员账号" autofocus required />
            </div>
          </label>
          <label class="login-field">
            <span>管理员密码</span>
            <div class="input-shell">
              <span aria-hidden="true"><AppIcon name="Lock" :size="14" /></span>
              <input v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="请输入管理员密码" required />
              <button type="button" class="password-toggle" :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword">
                {{ showPassword ? "隐藏" : "显示" }}
              </button>
            </div>
          </label>

          <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>
          <button type="submit" class="login-submit" :disabled="!canSubmit">
            <span v-if="submitting" class="button-spinner" aria-hidden="true"></span>
            {{ submitting ? "正在验证…" : "进入管理后台" }}
          </button>
        </form>
        <p class="login-footnote">密码不会写入前端代码或浏览器存储；会话通过 HttpOnly Cookie 维护。</p>
      </div>
    </section>
  </main>
</template>
