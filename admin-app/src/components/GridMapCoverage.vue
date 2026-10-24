<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { request } from '@/lib/api';

type Row = Record<string, any>;
const data = ref<Row | null>(null);
const loading = ref(false);
const error = ref('');
const query = ref('');
const page = ref(1);
const pageSize = 30;
let generation = 0;
const numberOf = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('zh-CN') : '—';
const reasonLabel = (row: Row) => {
  const value = row.reason || row.pendingReason;
  const labels: Record<string, string> = {
    outside_mainland_catalog: '港澳或境外学校，尚未补充可靠校址来源',
    campus_specific_location_not_verified: '具体校区所在地尚未核实，未沿用母校位置',
    no_verified_city_catalog: '现有来源缺少可核验的城市位置',
  };
  return labels[value] || value || '无可靠校区位置依据';
};
const unmatched = computed(() => (data.value?.unlocatedSchools || []).filter((row: Row) =>
  !query.value || [row.name, row.schoolName, row.campusName, row.province, row.reason].join(' ').includes(query.value.trim())));
const visibleRows = computed(() => unmatched.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const pages = computed(() => Math.max(1, Math.ceil(unmatched.value.length / pageSize)));
const load = async () => {
  const id = ++generation;
  page.value = 1;
  loading.value = true; error.value = ''; data.value = null;
  try { const result = await request<Row>('/admin/grid-map/coverage'); if (id === generation) data.value = result; }
  catch (e) { if (id === generation) error.value = e instanceof Error ? e.message : '地图数据核对加载失败'; }
  finally { if (id === generation) loading.value = false; }
};
onMounted(load);
onBeforeUnmount(() => { generation++; data.value = null; });
</script>

<template>
  <section class="map-coverage" aria-label="全国地图数据入库和位置核对">
    <header><div><h3>全国地图数据与位置</h3><p>学校所在地、招聘目的地分开统计。城市级定位只表示学校所在城市，不冒充校门或具体校区坐标。</p></div><button class="button secondary" :disabled="loading" @click="load">刷新核对</button></header>
    <p v-if="loading" role="status">正在读取数据库中的地图目录…</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <template v-if="data">
      <div class="cards">
        <article><span>母校 / 校区</span><strong>{{ numberOf(data.schoolCount) }} / {{ numberOf(data.campusCount) }}</strong></article>
        <article><span>招聘与资料单位目录</span><strong>{{ numberOf(data.companyCount) }}</strong></article>
        <article><span>录用公示单位</span><strong>{{ numberOf(data.rosterCompanyCount) }}</strong></article>
        <article><span>报名资料候选单位（待核）</span><strong>{{ numberOf(data.candidateCompanyCount) }}</strong></article>
        <article><span>校园代表点</span><strong>{{ numberOf(data.locationCounts?.campus) }}</strong></article>
        <article><span>城市级定位</span><strong>{{ numberOf(data.locationCounts?.city) }}</strong></article>
        <article><span>位置待核</span><strong>{{ numberOf(data.locationCounts?.unlocated) }}</strong></article>
      </div>
      <p class="version">目录版本：{{ data.catalogVersion || '尚未入库' }} · 学校原名规则 {{ numberOf(data.schoolAliasCount) }} · 单位原名规则 {{ numberOf(data.unitAliasCount) }}</p>
      <div class="table-wrap"><table><caption>按行政省份核对（学校按所在地，单位按资料明确的省份；资料单位不等于录用单位）</caption><thead><tr><th>省份</th><th>当地校区</th><th>单位目录</th><th>有资料的城市</th><th>公示记录</th></tr></thead><tbody><tr v-for="row in data.provinces || []" :key="row.adcode"><th scope="row">{{ row.name }}</th><td>{{ numberOf(row.schoolCount) }}</td><td>{{ numberOf(row.companyCount) }}</td><td>{{ numberOf(row.policyCityCount) }}</td><td>{{ numberOf(row.recordCount) }}</td></tr></tbody></table></div>
      <p class="note">公示记录不是实际入职人数。未明确行政省市的总部、直属单位等记录保留全国口径，不会硬分给某个城市；报名单位资料也不计入录用公示记录。</p>
      <h3>位置待核清单</h3>
      <form @submit.prevent="page = 1"><label>搜索学校或校区 <input v-model="query" maxlength="120" placeholder="学校、校区、待核原因" @input="page = 1" /></label></form>
      <div class="table-wrap"><table><caption>{{ numberOf(unmatched.length) }} 个待核校区，均保留可查询数据</caption><thead><tr><th>学校 / 校区</th><th>已知地区</th><th>待核原因</th></tr></thead><tbody><tr v-for="row in visibleRows" :key="row.campusKey"><th scope="row">{{ row.name || row.schoolName }}<small>{{ row.campusName }}</small></th><td>{{ row.province || '未确认' }}</td><td>{{ reasonLabel(row) }}</td></tr><tr v-if="!visibleRows.length"><td colspan="3">没有匹配的待核项。</td></tr></tbody></table></div>
      <div class="pagination"><button class="button secondary compact" :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }} / {{ pages }}</span><button class="button secondary compact" :disabled="page >= pages" @click="page++">下一页</button></div>
      <ul class="note"><li v-for="(note, index) in data.notes || []" :key="index">{{ note }}</li></ul>
    </template>
  </section>
</template>

<style scoped>
.map-coverage header { display:flex; align-items:start; justify-content:space-between; gap:20px; }
h3 { margin:12px 0; color:var(--ink-strong); }p,.note { font-size:13px; line-height:1.8; color:var(--ink-muted); }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin:20px 0; }
.cards article { background:white; border:1px solid var(--line); border-radius:12px; padding:18px; }.cards span { font-size:12px; color:var(--ink-muted); }.cards strong { display:block; margin-top:8px; font-size:24px; color:var(--ink-strong); }
.table-wrap { overflow:auto; background:white; border:1px solid var(--line); border-radius:12px; margin:15px 0; }table { width:100%; border-collapse:collapse; font-size:13px; min-width:600px; }caption { padding:15px; text-align:left; color:var(--ink-muted); }th,td { padding:13px 16px; text-align:left; border-top:1px solid var(--line); }thead { background:#edf7fd; }small { display:block; color:var(--ink-muted); margin-top:4px; font-weight:400; }
input { margin-left:12px; padding:10px; border:1px solid var(--line); border-radius:8px; max-width:100%; }label { font-size:13px; }.pagination { display:flex; justify-content:flex-end; align-items:center; gap:15px; }.version { overflow-wrap:anywhere; }.error { color:#9f442a; padding:15px; background:#fff3e7; border-radius:10px; }
@media(max-width:700px) { .map-coverage header { flex-direction:column; }input { margin:8px 0; width:100%; } }
</style>
