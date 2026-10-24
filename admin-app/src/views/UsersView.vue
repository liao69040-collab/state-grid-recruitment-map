<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { normalizePage, queryString, request } from "@/lib/api";
import { toast } from "@/lib/toast";
import AppIcon from "@/components/AppIcon.vue";
import { useDialogFocus } from "@/lib/dialog-focus";

type UserRecord = Record<string, unknown> & {
  id?: string;
  phoneMasked?: string;
  displayName?: string;
  enabled?: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
};

const users = ref<UserRecord[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(15);
const search = ref("");
const statusFilter = ref("");
const loading = ref(false);
const loadError = ref("");
let loadGeneration = 0;
const dialogMode = ref<"create" | "edit" | "reset" | null>(null);
const activeUser = ref<UserRecord | null>(null);
const saving = ref(false);
const pendingRemove = ref<UserRecord | null>(null);
const removing = ref(false);

const createForm = reactive({ phone: "", displayName: "", password: "" });
const resetForm = reactive({ password: "" });
const editForm = reactive({ displayName: "", enabled: true });

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const enabledCount = computed(() => users.value.filter((user) => user.enabled).length);

const load = async () => {
  const generation = ++loadGeneration;
  const requestedPage = page.value;
  const requestedPageSize = pageSize.value;
  loading.value = true;
  loadError.value = "";
  try {
    const payload = await request<Record<string, unknown>>(`/admin/users${queryString({
      q: search.value.trim(),
      enabled: statusFilter.value,
      limit: requestedPageSize,
      offset: (requestedPage - 1) * requestedPageSize,
    })}`);
    if (generation !== loadGeneration) return;
    const normalized = normalizePage(payload as { items?: UserRecord[]; total?: number }, requestedPage, requestedPageSize);
    users.value = normalized.items;
    total.value = normalized.meta.total;
    if (page.value > totalPages.value) {
      page.value = totalPages.value;
      await load();
    }
  } catch (error) {
    if (generation !== loadGeneration) return;
    loadError.value = error instanceof Error ? error.message : "用户数据读取失败。";
    users.value = [];
    total.value = 0;
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
};

const submitFilter = () => {
  page.value = 1;
  void load();
};

const openCreate = () => {
  Object.assign(createForm, { phone: "", displayName: "", password: "" });
  dialogMode.value = "create";
};

const openEdit = (user: UserRecord) => {
  activeUser.value = user;
  Object.assign(editForm, { displayName: String(user.displayName || ""), enabled: Boolean(user.enabled) });
  dialogMode.value = "edit";
};

const openReset = (user: UserRecord) => {
  resetForm.password = "";
  activeUser.value = user;
  dialogMode.value = "reset";
};

const closeDialog = () => {
  if (saving.value) return;
  dialogMode.value = null;
  activeUser.value = null;
  createForm.password = "";
  resetForm.password = "";
};
const dialogElement = ref<HTMLElement | null>(null);
useDialogFocus(dialogElement, closeDialog, () => saving.value);

const createUser = async () => {
  if (!/^1[3-9]\d{9}$/.test(createForm.phone.trim())) {
    toast.error("请输入有效的 11 位中国大陆手机号。 ");
    return;
  }
  saving.value = true;
  try {
    await request("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        phone: createForm.phone.trim(),
        password: createForm.password,
        ...(createForm.displayName.trim() ? { displayName: createForm.displayName.trim() } : {}),
      }),
    });
    toast.success("手机号已授权，请通过安全渠道告知用户登录密码。");
    createForm.password = "";
    dialogMode.value = null;
    activeUser.value = null;
    await load();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "用户授权失败。 ");
  } finally {
    saving.value = false;
  }
};

const updateUser = async () => {
  if (!activeUser.value?.id) return;
  saving.value = true;
  try {
    await request(`/admin/users/${encodeURIComponent(activeUser.value.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName: editForm.displayName.trim() || null, enabled: editForm.enabled }),
    });
    toast.success("用户授权状态已更新。 ");
    dialogMode.value = null;
    activeUser.value = null;
    await load();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "用户更新失败。 ");
  } finally {
    saving.value = false;
  }
};

const resetPassword = async () => {
  if (!activeUser.value?.id) return;
  saving.value = true;
  try {
    await request(`/admin/users/${encodeURIComponent(activeUser.value.id)}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password: resetForm.password }),
    });
    toast.success("密码已重置，原有会话已撤销。");
    resetForm.password = "";
    dialogMode.value = null;
    activeUser.value = null;
    await load();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "密码重置失败。 ");
  } finally {
    saving.value = false;
  }
};

const removeAuthorization = async () => {
  if (!pendingRemove.value?.id) return;
  removing.value = true;
  try {
    await request(`/admin/users/${encodeURIComponent(pendingRemove.value.id)}`, { method: "DELETE" });
    toast.success("手机号授权已移除，原有会话已撤销。 ");
    pendingRemove.value = null;
    await load();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "移除授权失败。 ");
  } finally {
    removing.value = false;
  }
};

const formatDate = (value: unknown) => {
  if (!value) return "从未登录";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "待核";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
};

const goPage = (next: number) => {
  if (next < 1 || next > totalPages.value) return;
  page.value = next;
  void load();
};

onMounted(load);
onBeforeUnmount(() => { loadGeneration++; users.value = []; activeUser.value = null; pendingRemove.value = null; });
</script>

<template>
  <section class="page-section">
    <div class="page-lead">
      <div>
        <span class="eyebrow">访问权限</span>
        <h2>手机号用户授权</h2>
        <p>只有已授权并启用的手机号可以从全国地图进入省级详情；后台不展示完整手机号。</p>
      </div>
      <button type="button" class="button primary" @click="openCreate"><AppIcon name="Plus" :size="15" /> 授权手机号</button>
    </div>

    <div class="summary-strip">
      <div><span>当前结果</span><b>{{ total }}</b><small>个授权账号</small></div>
      <div><span>本页启用</span><b>{{ enabledCount }}</b><small>个可访问账号</small></div>
      <div class="summary-security"><span class="status-dot"></span><p><b>安全会话</b><small>停用、移除授权或重置密码将立即撤销用户会话</small></p></div>
    </div>

    <div class="data-card">
      <div class="data-toolbar users-toolbar">
        <form class="search-form" @submit.prevent="submitFilter">
          <AppIcon name="Search" :size="18" />
          <input v-model="search" type="search" placeholder="搜索手机号尾号或备注名" />
          <select v-model="statusFilter" aria-label="授权状态">
            <option value="">全部状态</option>
            <option value="true">已启用</option>
            <option value="false">已停用</option>
          </select>
          <button type="submit" class="button secondary compact">筛选</button>
        </form>
        <span class="privacy-label">完整手机号仅用于服务端校验</span>
      </div>

      <div v-if="loading" class="table-loading"><span v-for="n in 6" :key="n"></span></div>
      <div v-else-if="loadError" class="state-panel error-state">
        <div class="state-icon"><AppIcon name="WarningFilled" :size="24" /></div><h3>用户列表读取失败</h3><p>{{ loadError }}</p>
        <button type="button" class="button secondary" @click="load">重新加载</button>
      </div>
      <div v-else-if="!users.length" class="state-panel empty-state">
        <div class="state-icon"><AppIcon name="User" :size="24" /></div><h3>暂无授权用户</h3><p>点击“授权手机号”创建第一个地图访问账号。</p>
        <button type="button" class="button primary" @click="openCreate">授权手机号</button>
      </div>
      <div v-else class="table-wrap">
        <table class="data-table user-table">
          <thead><tr><th>手机号</th><th>备注名</th><th>状态</th><th>最近登录</th><th>创建时间</th><th class="action-column">操作</th></tr></thead>
          <tbody>
            <tr v-for="user in users" :key="user.id">
              <td><b class="masked-phone">{{ user.phoneMasked || "已脱敏" }}</b></td>
              <td>{{ user.displayName || "—" }}</td>
              <td><span class="status-pill" :class="user.enabled ? 'status-published' : 'status-archived'">{{ user.enabled ? "已启用" : "已停用" }}</span></td>
              <td>{{ formatDate(user.lastLoginAt) }}</td>
              <td>{{ formatDate(user.createdAt) }}</td>
              <td class="row-actions">
                <button type="button" class="row-button" @click="openEdit(user)">编辑</button>
                <button type="button" class="row-button" @click="openReset(user)">重置密码</button>
                <button type="button" class="row-button danger-text" @click="pendingRemove = user">移除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer v-if="total" class="pagination-bar">
        <span>共 {{ total }} 个授权账号</span>
        <div class="pagination-actions">
          <button type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
          <b>{{ page }} / {{ totalPages }}</b>
          <button type="button" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
        </div>
      </footer>
    </div>

    <Teleport to="body">
      <div v-if="dialogMode" class="dialog-backdrop" role="presentation" @mousedown.self="closeDialog">
        <section ref="dialogElement" class="entity-dialog user-dialog" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title" :aria-busy="saving" tabindex="-1">
          <header class="entity-dialog__header">
            <div>
              <span class="eyebrow">用户权限</span>
              <h2 id="user-dialog-title">{{ dialogMode === "create" ? "授权新手机号" : dialogMode === "edit" ? "编辑用户授权" : "重置用户密码" }}</h2>
            </div>
            <button type="button" class="icon-button" aria-label="关闭" @click="closeDialog"><AppIcon name="Close" :size="18" /></button>
          </header>

          <form v-if="dialogMode === 'create'" id="user-create" class="entity-form single-column" @submit.prevent="createUser">
            <label class="form-field"><span>手机号码 <b>*</b></span><input v-model="createForm.phone" type="tel" inputmode="numeric" maxlength="11" autocomplete="off" placeholder="11 位中国大陆手机号" required /><small>保存后列表只显示脱敏手机号。</small></label>
            <label class="form-field"><span>备注名</span><input v-model="createForm.displayName" type="text" autocomplete="off" placeholder="如：直播运营 1 号" /></label>
            <label class="form-field"><span>登录密码 <b>*</b></span><input v-model="createForm.password" type="password" autocomplete="new-password" minlength="8" maxlength="256" required /></label>
            <p class="password-warning">请为每个账号设置独立密码，至少 8 个字符。</p>
          </form>
          <form v-else-if="dialogMode === 'edit'" id="user-edit" class="entity-form single-column" @submit.prevent="updateUser">
            <div class="readonly-identity"><span>授权手机号</span><b>{{ activeUser?.phoneMasked }}</b></div>
            <label class="form-field"><span>备注名</span><input v-model="editForm.displayName" type="text" autocomplete="off" /></label>
            <label class="form-field is-toggle"><span class="toggle-copy"><strong>允许进入省级地图</strong><small>关闭后该账号的现有会话将失效。</small></span><input v-model="editForm.enabled" type="checkbox" class="toggle-input" /></label>
          </form>
          <form v-else id="user-reset" class="entity-form single-column" @submit.prevent="resetPassword">
            <div class="readonly-identity"><span>重置账号</span><b>{{ activeUser?.phoneMasked }}</b></div>
            <label class="form-field"><span>新密码 <b>*</b></span><input v-model="resetForm.password" type="password" autocomplete="new-password" minlength="8" maxlength="256" required /></label>
            <p class="password-warning">确认后更新密码，该账号在所有设备上的现有会话都会立即失效。</p>
          </form>

          <footer class="entity-dialog__footer">
            <span>{{ dialogMode === "edit" ? "停用账号会立即撤销现有会话。" : "请为每个账号设置独立密码。" }}</span>
            <div class="dialog-actions">
              <button type="button" class="button secondary" :disabled="saving" @click="closeDialog">取消</button>
              <button type="submit" :form="dialogMode === 'create' ? 'user-create' : dialogMode === 'edit' ? 'user-edit' : 'user-reset'" class="button primary" :disabled="saving">
                <span v-if="saving" class="button-spinner"></span>{{ saving ? "保存中…" : "确认保存" }}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </Teleport>

    <ConfirmDialog
      v-if="pendingRemove"
      title="移除手机号授权"
      :description="`确定移除 ${pendingRemove.phoneMasked || '该账号'} 的访问权限吗？该账号现有会话会立即失效。`"
      confirm-text="移除授权"
      danger
      :loading="removing"
      @cancel="pendingRemove = null"
      @confirm="removeAuthorization"
    />
  </section>
</template>
