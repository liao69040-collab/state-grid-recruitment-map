<script setup lang="ts">
import { computed } from "vue";
import { displayText, fieldLabels, rawValue } from "@/lib/display";
const props = withDefaults(defineProps<{ value: unknown; depth?: number; fieldKey?: string }>(), { depth: 0 });
const isObject = computed(() => props.value !== null && typeof props.value === "object" && !Array.isArray(props.value));
const entries = computed(() => isObject.value ? Object.entries(props.value as Record<string, unknown>) : []);
const translated = computed(() => displayText(props.value, '未提供', props.fieldKey ? { key: props.fieldKey } : undefined));
</script>

<template>
  <div class="structured-value">
    <template v-if="depth > 5 && value && typeof value === 'object'"><details><summary>查看更多层级信息</summary><pre>{{ rawValue(value) }}</pre></details></template>
    <template v-else-if="Array.isArray(value)">
      <p v-if="!value.length" class="value-empty">暂无条目</p>
      <ol v-else><li v-for="(item, index) in value" :key="index"><StructuredValue :value="item" :depth="depth + 1" :field-key="fieldKey" /></li></ol>
    </template>
    <dl v-else-if="isObject && entries.length"><div v-for="[key, item] in entries" :key="key"><dt>{{ fieldLabels[key] || '扩展信息' }}<small v-if="!fieldLabels[key]">字段：{{ key }}</small></dt><dd><StructuredValue :value="item" :depth="depth + 1" :field-key="key" /></dd></div></dl>
    <p v-else-if="isObject" class="value-empty">暂无详细信息</p>
    <p v-else>{{ translated }}</p>
  </div>
</template>

<style scoped>
.structured-value{min-width:0;font-size:13px;line-height:1.7;overflow-wrap:anywhere}.structured-value p{margin:0;white-space:pre-wrap}.structured-value dl{margin:0;display:grid;gap:9px}.structured-value dl>div{padding:8px 10px;background:#f5f9fc;border-radius:7px}.structured-value dt{color:#486c80;font-size:12px;font-weight:600}.structured-value dd{margin:4px 0 0}.structured-value small{display:block;font-size:10px;font-weight:400;color:#728d9c}.structured-value ol{padding-left:20px;margin:0;display:grid;gap:7px}.structured-value pre{white-space:pre-wrap;font-size:11px;overflow-wrap:anywhere}.value-empty{color:#78909c}.structured-value summary{cursor:pointer;color:#157ead}
</style>
