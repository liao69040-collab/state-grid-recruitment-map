import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import ts from 'typescript';

const require = createRequire(import.meta.url);
async function componentUrl(file) {
  const { descriptor } = parse(await readFile(file, 'utf8'), { filename: file.pathname });
  const compiled = compileScript(descriptor, { id: file.pathname, inlineTemplate: true });
  let js = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from ["']vue["']/g, `from ${JSON.stringify(pathToFileURL(require.resolve('vue/dist/vue.runtime.esm-bundler.js')).href)}`);
  for (const match of [...js.matchAll(/from ["'](\.\.?\/[^"']+)["']/g)]) {
    const url = match[1].endsWith('.vue') ? await componentUrl(new URL(match[1], file)) : new URL(`${match[1]}.ts`, file).href;
    js = js.replace(match[0], `from ${JSON.stringify(url)}`);
  }
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
}
const Component = (await import(await componentUrl(new URL('./InformationEntityDetail.vue', import.meta.url)))).default;
const batches = { batch_1: null, batch_2: null, batch_3: null, csg_spring: null, csg_autumn: null };
function fixture(changes = {}) {
  return { company: { companyKey: 'example', company: '示例公司', grid: 'sgcc', province: '湖北省', recordCount: null, candidateStatus: 'reference_candidate', countBasis: 'complete_anonymous_aggregates', batchCounts: batches, ...changes }, schools: [], policyFacts: [], candidate: { references: [{ factKey: 'application', applicationCount: 88, cohortYear: 2026, batchCode: 'batch_1' }] } };
}
test('application-only company never renders a fabricated zero-school or recruitment panel', async () => {
  for (const detail of [fixture(), fixture({ recordCount: 0 }), fixture({ candidateStatus: 'policy_reference' }), fixture({ candidateStatus: 'roster_unit', recordCount: null })]) {
    const html = await renderToString(createSSRApp(Component, { detail, province: '湖北省', year: '2026届' }));
    assert.ok(!html.includes('录用院校'));
    assert.ok(!html.includes('各批次录用公示'));
    assert.ok(!html.includes('录用公示数量'));
    assert.ok(html.includes('88') && html.includes('人次'));
  }
});
test('verified roster totals still render school counts including a genuine zero', async () => {
  const detail = { ...fixture({ candidateStatus: 'roster_unit', recordCount: 0, batchCounts: { ...batches, batch_1: 0 } }), candidate: null };
  const html = await renderToString(createSSRApp(Component, { detail, province: '湖北省', year: '2026届' }));
  assert.ok(html.includes('录用院校 · 0 个校区'));
  assert.ok(html.includes('各批次录用公示'));
  assert.ok(html.includes('录用公示数量'));
});
