<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { FieldDefinition, ResourceDefinition } from "@/types";
import AppIcon from "@/components/AppIcon.vue";
import StructuredValue from "@/components/StructuredValue.vue";
import { displayText, groupFields, hasEncodingIssue, rawValue } from "@/lib/display";
import { editableFields, fieldWasChanged } from "@/lib/entity-form";
import { useDialogFocus } from "@/lib/dialog-focus";

const props = defineProps<{
  resource: ResourceDefinition;
  item?: Record<string, unknown> | null;
  loading?: boolean;
  readonly?: boolean;
  previewSrc?: string;
}>();

const emit = defineEmits<{ cancel: []; submit: [payload: Record<string, unknown>] }>();
type FormValue = string | number | boolean | null | undefined;
// Dynamic fields are selected by the resource schema; Vue's template v-model
// cannot narrow an indexed union even though each rendered control does.
const form = reactive<Record<string, any>>({});
const formError = ref("");
const previewError = ref(false);
const isEditing = computed(() => Boolean(props.item));
const detailGroups = computed(() => groupFields(props.resource.fields));
const loadedFields = computed(() => editableFields(props.resource.fields, props.item));
const editGroups = computed(() => groupFields(loadedFields.value));
const omittedFieldCount = computed(() => props.resource.fields.filter(field => !field.readonly).length - loadedFields.value.length);
const readValue = (field: FieldDefinition) => props.item?.[field.key];

const toLocalDateTime = (value: unknown) => {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(" ", "T");
};

const initialValue = (field: FieldDefinition, value: unknown) => {
  if (field.kind === "boolean") return Boolean(value);
  if (field.kind === "datetime-local") return toLocalDateTime(value);
  if (field.kind === "date" && value) return String(value).slice(0, 10);
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return (value as FormValue) ?? "";
};

const reset = () => {
  formError.value = "";
  previewError.value = false;
  Object.keys(form).forEach((key) => delete form[key]);
  props.resource.fields.forEach((field) => {
    if (!field.readonly) form[field.key] = initialValue(field, props.item?.[field.key]);
  });
};

watch(() => [props.resource, props.item], reset, { immediate: true, deep: true });

const submit = () => {
  if (props.readonly) return;
  formError.value = "";
  const payload: Record<string, unknown> = {};
  try {
    loadedFields.value.forEach((field) => {
      if (isEditing.value && !fieldWasChanged(form[field.key], initialValue(field, props.item?.[field.key]))) return;
      let value = form[field.key];
      if (field.kind === "number") value = value === "" ? null : Number(value);
      if (field.kind === "datetime-local" && typeof value === "string" && value) {
        value = `${value}${value.length === 16 ? ":00" : ""}+08:00`;
      }
      if (field.kind === "json" && typeof value === "string" && value.trim()) {
        try {
          value = JSON.parse(value);
        } catch {
          throw new Error(`${field.label}必须是有效的 JSON。`);
        }
      }
      if (typeof value === "string") value = value.trim();
      if (isEditing.value) {
        payload[field.key] = value === "" ? null : value;
      } else if (value !== "" && value !== null && value !== undefined) {
        payload[field.key] = value;
      }
    });
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "请检查表单内容。";
    return;
  }
  if (isEditing.value && !Object.keys(payload).length) { formError.value = "内容尚未修改，无需保存。"; return; }
  emit("submit", payload);
};

const onSelect = (field: FieldDefinition, event: Event) => {
  const raw = (event.target as HTMLSelectElement).value;
  const match = field.options?.find((option) => String(option.value) === raw);
  form[field.key] = match?.value ?? raw;
};

const dialogElement = ref<HTMLElement | null>(null);
useDialogFocus(dialogElement, () => emit("cancel"), () => Boolean(props.loading));
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" role="presentation" @mousedown.self="!loading && emit('cancel')">
      <section ref="dialogElement" class="entity-dialog" role="dialog" aria-modal="true" :aria-labelledby="`${resource.key}-dialog-title`" :aria-busy="loading" tabindex="-1">
        <header class="entity-dialog__header">
          <div>
            <span class="eyebrow">{{ readonly ? "资料详情 · 只读查看" : "业务数据 · 维护编辑" }}</span>
            <h2 :id="`${resource.key}-dialog-title`">{{ readonly ? `查看${resource.singular}` : isEditing ? `编辑${resource.singular}` : `新建${resource.singular}` }}</h2>
          </div>
          <button type="button" class="icon-button" aria-label="关闭" :disabled="loading" @click="emit('cancel')"><AppIcon name="Close" :size="18" /></button>
        </header>

        <form id="entity-form" class="entity-form" @submit.prevent="submit">
          <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
          <p v-if="!readonly && omittedFieldCount" class="form-error" role="note">此列表未返回 {{ omittedFieldCount }} 个字段；它们不参与本次编辑和保存，原值保持不变。</p>
          <figure v-if="previewSrc" class="source-original-preview">
            <figcaption>私有原图 · 仅供管理员核验，不能据此直接发布招聘结论</figcaption>
            <p v-if="previewError" role="status">原图暂不可用：私有归档尚未挂载、文件校验未通过或会话已失效。下方 OCR 不可代替原图核验。</p>
            <img v-else :src="previewSrc" alt="待核资料原图" decoding="async" @error="previewError = true" />
          </figure>
          <template v-if="readonly">
            <details v-for="group in detailGroups" :key="group.label" class="detail-field-group" :open="group.label !== '关联与技术信息'">
              <summary>{{ group.label }}</summary>
              <dl><div v-for="field in group.fields" :key="field.key"><dt>{{ field.label.replace(/（JSON[^）]*）/g, '') }}</dt><dd>
                <StructuredValue v-if="readValue(field) && typeof readValue(field) === 'object'" :value="readValue(field)" />
                <p v-else>{{ displayText(readValue(field), field.emptyLabel || '未提供', field) }}</p>
                <p v-if="hasEncodingIssue(readValue(field))" class="encoding-warning">该字段含异常字符，请核对原件；当前显示未改写原始内容。</p>
                <details v-if="readValue(field) != null && (typeof readValue(field) === 'object' || displayText(readValue(field), '', field) !== String(readValue(field)))" class="raw-value"><summary>查看内部原值</summary><pre>{{ rawValue(readValue(field)) }}</pre></details>
              </dd></div></dl>
            </details>
          </template>
          <details v-else v-for="group in editGroups" :key="group.label" class="edit-field-group" :open="group.label !== '关联与技术信息'">
          <summary>{{ group.label }}</summary>
          <div class="edit-field-grid">
          <label
            v-for="field in group.fields"
            :key="field.key"
            class="form-field"
            :class="[`width-${field.width || 'normal'}`, { 'is-toggle': field.kind === 'boolean' }]"
          >
            <template v-if="field.kind === 'boolean'">
              <span class="toggle-copy">
                <strong>{{ field.label }}</strong>
                <small v-if="field.help">{{ field.help }}</small>
              </span>
              <input v-model="form[field.key]" type="checkbox" class="toggle-input" :disabled="readonly" />
            </template>
            <template v-else>
              <span>{{ field.label }} <b v-if="field.required" aria-hidden="true">*</b></span>
              <textarea
                v-if="field.kind === 'textarea' || field.kind === 'json'"
                v-model="form[field.key]"
                :required="field.required"
                :placeholder="field.placeholder"
                :rows="field.rows || 3"
                :readonly="readonly"
              ></textarea>
              <select v-else-if="field.kind === 'select'" :value="String(form[field.key] ?? '')" :required="field.required" :disabled="readonly" @change="onSelect(field, $event)">
                <option value="">请选择</option>
                <option v-for="option in field.options" :key="String(option.value)" :value="String(option.value)">{{ option.label }}</option>
              </select>
              <input
                v-else
                v-model="form[field.key]"
                :type="field.kind || 'text'"
                :required="field.required"
                :placeholder="field.placeholder"
                :min="field.min"
                :step="field.step"
                :readonly="readonly"
                autocomplete="off"
              />
              <small v-if="field.help">{{ field.help }}</small>
            </template>
          </label>
          </div></details>
        </form>

        <footer class="entity-dialog__footer">
          <span v-if="readonly">只读查看，不会更改来源、统计数据或发布状态。</span>
          <span v-else><b>*</b> 为必填项；时间按北京时间保存。</span>
          <div class="dialog-actions">
            <button type="button" class="button secondary" :disabled="loading" @click="emit('cancel')">{{ readonly ? "关闭" : "取消" }}</button>
            <button v-if="!readonly" type="submit" form="entity-form" class="button primary" :disabled="loading">
              <span v-if="loading" class="button-spinner" aria-hidden="true"></span>
              {{ loading ? "保存中…" : "保存" }}
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.source-original-preview { grid-column: 1 / -1; margin: 0; border: 1px solid #c6e0ee; border-radius: 12px; padding: 14px; background: #f6fbfe; }
.source-original-preview figcaption { color: #476c80; margin-bottom: 10px; font-size: 13px; }
.source-original-preview img { display: block; max-width: 100%; max-height: 480px; object-fit: contain; margin: auto; }
.source-original-preview p { color: #815c32; line-height: 1.6; }
.detail-field-group,.edit-field-group{grid-column:1 / -1;min-width:0;margin:0}.detail-field-group>summary,.edit-field-group>summary{font-size:15px;font-weight:700;cursor:pointer;color:#245f80;border-bottom:1px solid #d5e6ee;padding:10px 0;margin:6px 0 12px}.edit-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.detail-field-group dl{margin:0;display:grid;gap:14px}.detail-field-group dl>div{min-width:0}.detail-field-group dt{font-size:12px;color:#567889;font-weight:700;margin-bottom:5px}.detail-field-group dd{margin:0;font-size:13px;line-height:1.7;overflow-wrap:anywhere}.detail-field-group p{margin:0;white-space:pre-wrap}.raw-value{font-size:11px;color:#688592;margin-top:7px}.raw-value summary{cursor:pointer}.raw-value pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;background:#f3f7fa;border-radius:7px}.encoding-warning{color:#a14d27!important}@media(max-width:680px){.edit-field-grid{grid-template-columns:1fr}}
</style>
