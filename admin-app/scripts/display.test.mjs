import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { displayText, groupFields, hasEncodingIssue, rawValue, dateText } from '../src/lib/display.ts';
import { editableFields, fieldWasChanged } from '../src/lib/entity-form.ts';
import { directoryCount, directoryHasRosterCount, filterDirectoryRows } from '../src/lib/directory-display.ts';
import { navigationGroups } from '../src/config/navigation.ts';
import { resources } from '../src/config/resources.ts';
const source = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('known business enums use Chinese without changing internal values', () => {
  for (const [value, label] of [['sgcc','国家电网'],['batch_2','第二批'],['public_notice_record_count','录用公示条数'],['reference_candidate','招聘参考单位']]) assert.equal(displayText(value), label);
  assert.equal(displayText('future_unsupported_enum'), 'future_unsupported_enum');
});
test('ambiguous campus and visibility tokens use field context', () => {
  assert.equal(displayText('campus','',{key:'batchCode'}),'提前批');
  assert.equal(displayText('campus','',{key:'locationPrecision'}),'校园代表点');
  assert.equal(displayText('campus','',{key:'view'}),'校区明细');
  assert.equal(displayText('public','',{key:'visibility'}),'公开可见');
});
test('declared field options win over global translations', () => assert.equal(displayText('all','',{key:'batchCode',options:[{value:'all',label:'全批次适用'}]}), '全批次适用'));
test('missing counts remain distinct from a confirmed zero', () => {
  for (const value of [null,undefined,NaN,Infinity]) assert.equal(directoryCount(value),'未提供');
  assert.equal(directoryCount(0),'0'); assert.equal(displayText(null),'未提供'); assert.equal(displayText(0),'0');
});
test('objects are summarized instead of [object Object] or raw JSON in tables', () => {
  assert.equal(displayText({education:'master'}),'1 项详细信息');
  assert.equal(displayText(['sgcc','csg']),'国家电网、南方电网');
  assert.deepEqual(JSON.parse(rawValue({education:'master'})),{education:'master'});
});
test('grouping preserves every original field exactly once', () => {
  for (const resource of resources) {
    const grouped = groupFields(resource.fields).flatMap(group=>group.fields);
    assert.equal(grouped.length,resource.fields.length);
    assert.deepEqual([...new Set(grouped.map(field=>field.key))].sort(),resource.fields.map(field=>field.key).sort());
  }
});
test('hierarchical navigation covers all resources exactly once', () => {
  const keys = navigationGroups.flatMap(group=>group.keys);
  assert.equal(new Set(keys).size,keys.length);
  assert.deepEqual([...keys].sort(),resources.map(row=>row.key).sort());
  assert.ok(navigationGroups.some(group=>group.links.some(link=>link.path==='/grid-query?tab=directory')));
});
test('an edit excludes API-projected missing fields but keeps explicit null/false', () => {
  const fields=[{key:'name',label:'名称'},{key:'count',label:'数量'},{key:'enabled',label:'启用'},{key:'missing',label:'缺失'},{key:'id',label:'编号',readonly:true}];
  assert.deepEqual(editableFields(fields,{id:1,name:'a',count:null,enabled:false}).map(row=>row.key),['name','count','enabled']);
  assert.equal(editableFields(fields,null).length,4);
  assert.ok(!editableFields(fields,{missing:undefined}).length);
});
test('an unchanged input is omitted from PATCH including checkbox null-to-false initialization', () => {
  assert.equal(fieldWasChanged(false,false),false);
  assert.equal(fieldWasChanged('', ''),false);
  assert.equal(fieldWasChanged('new','old'),true);
  const component=source('components/EntityDialog.vue');
  assert.ok(component.includes('loadedFields.value.forEach'));
  assert.ok(component.includes('isEditing.value && !fieldWasChanged'));
});
test('company reference/policy-only rows never display a fabricated roster zero', () => {
  assert.equal(directoryHasRosterCount({recordCount:0,candidateStatus:'reference_candidate'},'companies'),false);
  assert.equal(directoryHasRosterCount({recordCount:0,candidateStatus:'policy_reference'},'companies'),false);
  assert.equal(directoryHasRosterCount({recordCount:null,candidateStatus:'roster_unit'},'companies'),false);
  assert.equal(directoryHasRosterCount({recordCount:0,candidateStatus:'roster_unit'},'companies'),true);
});
test('directory city filtering uses explicit school/candidate index, never recruitment destination', () => {
  const rows=[{schoolName:'甲大学',cityAdcode:'420500',destinationCity:'武汉市'},{schoolName:'乙大学',cityAdcode:'420100'}];
  assert.deepEqual(filterDirectoryRows(rows,'schools','420500','').map(row=>row.schoolName),['甲大学']);
  assert.equal(filterDirectoryRows([{company:'甲公司',companyCityAdcode:'420500'}],'companies','420500','甲').length,1);
  assert.equal(filterDirectoryRows([{company:'甲公司',destinationCity:'420500'}],'companies','420500','').length,0);
});
test('delete confirmation binds the record to its original resource and route changes close it', () => {
  const component=source('views/ResourceView.vue');
  assert.ok(component.includes('currentResource.key !== pendingDeleteResourceKey.value'));
  const watch=component.slice(component.indexOf('watch(() => route.params.resource'));
  assert.ok(watch.includes('pendingDelete.value = null'));
  assert.ok(watch.includes('pendingDeleteResourceKey.value = ""'));
});
test('admin defaults to 2026 and still provides an explicit all-year option', () => {
  const component=source('views/GridQueryView.vue');
  assert.ok(component.includes('cohortYear: "2026"'));
  assert.ok(component.includes('全部年份（含未注明）'));
  assert.ok(component.includes('row.text'));
  assert.ok(component.includes('group.items'));
});
test('a selected directory batch does not label filtered-out batches as actual zero counts', () => {
  const component=source('components/GridNationalDirectory.vue');
  assert.ok(component.includes('batch.value ? { [batch.value]:'));
  assert.ok(component.includes("batch ? '当前批次录用公示' : '各批次录用公示'"));
  assert.ok(component.includes('in shownBatchCounts'));
});
test('encoding detection reports replacement characters without modifying source', () => {
  const original='原件\uFFFD字'; assert.equal(hasEncodingIssue(original),true); assert.equal(rawValue(original),original);
  assert.equal(hasEncodingIssue('中华人民共和国'),false);
});
test('dates are rendered in Beijing time', () => assert.match(dateText('2026-09-23T00:00:00Z'),/08:00/));
test('coordinate decimals remain precise and a cohort year is not a thousands-formatted count', () => {
  assert.equal(displayText(112.269637),'112.269637');
  assert.equal(displayText(2026,'',{key:'cohortYear'}),'2026');
});
test('coverage refresh resets an old last page before shorter results arrive', async () => {
  const component=source('components/GridMapCoverage.vue');
  const body=component.match(/const load = async \(\) => \{([\s\S]+?)\n\};/)?.[1];
  assert.ok(body);
  const state={generation:0,page:{value:6},loading:{value:false},error:{value:''},data:{value:null},request:async()=>({unlocatedSchools:[{campusKey:'one'}]})};
  const run=new Function('state',`with (state) { return (async () => { ${body.replace('request<Row>', 'request')} })(); }`);
  await run(state);
  assert.equal(state.page.value,1);
  assert.equal(state.data.value.unlocatedSchools.length,1);
  assert.equal(state.loading.value,false);
});
test('browser document title matches the grid-neutral admin brand', () => {
  assert.ok(readFileSync(new URL('../index.html',import.meta.url),'utf8').includes('<title>电网招聘数据管理台</title>'));
});
