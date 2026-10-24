import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';

test('readonly grouped details render Chinese structured content without a save action', async () => {
  const server=await createServer({root:resolve(import.meta.dirname,'..'),server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
  try {
    const {default:EntityDialog}=await server.ssrLoadModule('/src/components/EntityDialog.vue');
    const resource={key:'test',title:'测试资料',singular:'资料',endpoint:'/read-only-test',fields:[
      {key:'cohortYear',label:'招聘届别',kind:'number'},
      {key:'batchCode',label:'招聘批次'},
      {key:'publicationStatus',label:'发布状态'},
      {key:'metadata',label:'扩展信息（JSON）',kind:'json'},
      {key:'sourcePrivacyBoundary',label:'可见范围',readonly:true},
    ]};
    const item={cohortYear:2026,batchCode:'batch_1',publicationStatus:'published',sourcePrivacyBoundary:'仅内部核对',metadata:{locationPrecision:'campus',visibility:'public',coordinates:[112.269637,30.736919],unknown_custom_key:{full_text:'完整原文没有删改'}}};
    const frozen=JSON.stringify(item);
    const context={};
    await renderToString(createSSRApp(EntityDialog,{resource,item,readonly:true}),context);
    const html=context.teleports.body;
    for(const label of ['招聘届别','2026','第一批','已发布','校园代表点','公开可见','112.269637','完整原文没有删改','unknown_custom_key','可见范围','查看内部原值']) assert.ok(html.includes(label),label);
    assert.ok(!html.includes('[object Object]'));
    assert.ok(!html.includes('type="submit"'));
    assert.equal(JSON.stringify(item),frozen);
    const editContext={};
    await renderToString(createSSRApp(EntityDialog,{resource,item:{cohortYear:2026},readonly:false}),editContext);
    assert.ok(editContext.teleports.body.includes('未返回 3 个字段'));
    assert.ok(!editContext.teleports.body.includes('扩展信息（JSON）'));
  } finally { await server.close(); }
});
