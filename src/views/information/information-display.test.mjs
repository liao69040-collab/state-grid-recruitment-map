import test from 'node:test';
import assert from 'node:assert/strict';
import { hasInformationProvinceContent, informationFactContext, informationFactDisplayText, informationFactGroup, informationFactPreview, informationFactTitle, informationMetricUnit, informationYear, summarizeInformationFacts } from './information-display.ts';
import { informationPageUrl, navigateInformationPage, navigateMapPage } from '../../services/information-navigation.ts';

const fact = (changes = {}) => ({ factKey: 'f1', datasetKey: 'input', version: '1', cohortYear: 2026, grid: 'sgcc', batchCode: 'batch_1', scope: 'province', province: '山西', city: null, company: null, category: 'education', title: '招聘要求', text: '国内公办二本及以上', educationLevel: null, schoolTier: null, applicability: 'direct', ...changes });

test('region reading links require actual coverage, not a geographic name', () => {
  assert.equal(hasInformationProvinceContent({ earlyBatchAvailable: false, factCount: 0 }), false);
  assert.equal(hasInformationProvinceContent({ earlyBatchAvailable: false, factCount: NaN }), false);
  assert.equal(hasInformationProvinceContent({ earlyBatchAvailable: false, factCount: 1 }), true);
  assert.equal(hasInformationProvinceContent({ earlyBatchAvailable: true, factCount: 0 }), true);
});

test('facts are organized by practical topics with experiences separate', () => {
  const examples = [['education', '招聘要求', 'requirements'], ['headcount', '计划招聘人数', 'numbers'], ['score', '26一批笔试线', 'scores'], ['exam', '考试安排', 'schedule'], ['compensation', '薪酬待遇', 'benefits'], ['other', '注意事项', 'other']];
  for (const [category, title, expected] of examples) assert.equal(informationFactGroup({ category, title }), expected);
});
test('exact duplicate paragraphs coalesce without modifying input', () => {
  const input = [fact(), fact({ factKey: 'duplicate', datasetKey: 'other' })];
  const before = JSON.stringify(input);
  assert.equal(summarizeInformationFacts(input)[0].items.length, 1);
  assert.equal(JSON.stringify(input), before);
});
test('importer annotations are not repeated and same-scope paragraph indexes collapse', () => {
  const suffix = '\n【条款说明】同一原文条款的主题索引，需结合完整单元格及上下文；资料准备不等于硬性准入。';
  const full = fact({ title: '提前批流程', text: '一、招聘专业：电工类硕士研究生\n二、招聘要求：年龄28岁以内' });
  const items = [full, fact({ factKey: 'i1', title: '原文条款：学历 / 提前批流程', text: '一、招聘专业：电工类硕士研究生' + suffix }), fact({ factKey: 'i2', title: '原文条款：专业 / 提前批流程', category: 'major', text: '一、招聘专业：电工类硕士研究生' + suffix })];
  assert.equal(summarizeInformationFacts(items).flatMap(group => group.items).length, 1);
  assert.equal(informationFactDisplayText(items[1].text), '一、招聘专业：电工类硕士研究生');
  assert.ok(items[1].text.includes('【条款说明】'));
  assert.equal(summarizeInformationFacts(items.slice(1)).flatMap(group => group.items).length, 1);
});
test('experience and competition anecdotes do not become formal conditions', () => {
  assert.equal(informationFactGroup(fact({ title: '提前批志愿、录取情况', text: '五、单位竞争情况\n双9希望较大' })), 'experience');
  assert.equal(informationFactGroup(fact({ title: '提前批流程', text: '一、招聘要求\n四、校招经验分享\n有同学被卡六级' })), 'experience');
  const text = '【用户经验资料摘录，未作官方核验；不是确定准入条件】\n城市仅作为查询索引；以下保留整段共同条件\n本段年份未明确或包含混合时间，不套用工作簿的2026标题。\n双9希望较大';
  assert.equal(informationFactDisplayText(text), '双9希望较大');
  assert.equal(informationFactGroup(fact({ title: '经验摘录', text })), 'experience');
});
test('machine flags stay out of the reading list and summaries are short bullet lines', () => {
  assert.equal(summarizeInformationFacts([fact({ title: '提前批本科通道原始标记', text: '0' })]).length, 0);
  assert.deepEqual(informationFactPreview('第一条\n第二条\n第三条\n第四条'), ['第一条', '第二条', '第三条']);
  assert.equal(informationFactPreview('长'.repeat(130))[0].length, 101);
});
test('image formulas do not create empty notes and application metrics are not requirements', () => {
  const formula = '=DISPIMG("ID_A2B6C69AAF734597AD5BCB29CFC72E9C",1)';
  assert.equal(informationFactDisplayText(formula), '');
  assert.equal(summarizeInformationFacts([fact({ title: '备注', text: formula })]).length, 0);
  const item = fact({ category: 'application', title: 'HTML报名汇总参考', text: '报名 20061' });
  assert.equal(informationFactGroup(item), 'numbers');
  assert.equal(informationFactTitle(item.title), '报名数量');
});
test('different years, batches, regions, companies and scope never merge', () => {
  const input = [fact(), fact({ cohortYear: 2025 }), fact({ batchCode: 'batch_2' }), fact({ province: '湖北' }), fact({ company: '甲公司' }), fact({ scope: 'city', city: '太原' }), fact({ applicability: 'province_inherited' })];
  assert.equal(summarizeInformationFacts(input)[0].items.length, 7);
});
test('indexes collapse only when the full text is available in the same scope', () => {
  assert.equal(summarizeInformationFacts([fact(), fact({ title: '原文条款主题索引', category: 'other' })]).flatMap(group => group.items).length, 1);
  assert.equal(summarizeInformationFacts([fact({ title: '原文条款主题索引', category: 'other' })]).flatMap(group => group.items).length, 1);
  assert.equal(summarizeInformationFacts([fact(), fact({ title: '主题索引', province: '湖北' })]).flatMap(group => group.items).length, 2);
});
test('context is short but retains actual year and regional scope', () => {
  const text = informationFactContext(fact());
  assert.equal(text, '2026届 · 山西 · 国网 · 第一批');
  assert.equal(informationYear(null), '年份未注明');
  assert.equal(informationFactTitle('HTML批次计划/录用对照'), '招聘与录用数量');
  assert.equal(informationFactTitle('招聘要求（以原文为准）'), '招聘要求');
});
test('public notice units are not silently converted into people', () => {
  assert.equal(informationMetricUnit({ metricType: 'public_notice_record_count', measureUnit: '条公示记录' }), '项录用公示');
  assert.equal(informationMetricUnit({ metricType: 'application_count', measureUnit: '人次' }), '人次');
  assert.equal(informationMetricUnit({ metricType: 'plan_count', measureUnit: '人（计划）' }), '人 · 招聘名额');
});
test('information URL remains responsive and keeps province filters', () => {
  const url = new URL(informationPageUrl('https://example.test/?__map_canvas=1920x1080#/index', { province: '湖北', tab: 'regions' }));
  assert.equal(url.searchParams.has('__map_canvas'), false);
  assert.match(decodeURIComponent(url.hash), /province=湖北/);
  assert.match(url.hash, /tab=regions/);
});
test('desktop map opens an event instead of navigating away', () => {
  const events = [];
  const fakeWindow = { location: { href: 'https://example.test/#/index', hash: '#/index', origin: 'https://example.test' }, dispatchEvent: event => events.push(event) };
  fakeWindow.parent = fakeWindow;
  globalThis.window = fakeWindow;
  globalThis.document = { documentElement: { classList: { contains: () => false } } };
  navigateInformationPage({ province: '山西' });
  assert.equal(events[0].type, 'grid-information-open');
  assert.equal(events[0].detail.province, '山西');
  delete globalThis.window; delete globalThis.document;
});
test('phone map requests a top-level responsive overlay', () => {
  const messages = [];
  globalThis.window = { parent: { postMessage: (...args) => messages.push(args) }, location: { href: 'https://example.test/?__map_canvas=1920x1080#/index', hash: '#/index', origin: 'https://example.test' } };
  globalThis.document = { documentElement: { classList: { contains: name => name === 'touch-desktop-canvas' } } };
  navigateInformationPage({ tab: 'schools' });
  assert.equal(messages[0][0].type, 'grid-information-open');
  assert.equal(new URL(messages[0][0].url).searchParams.has('__map_canvas'), false);
  assert.equal(messages[0][1], 'https://example.test');
  delete globalThis.window; delete globalThis.document;
});
test('modal return button closes outer overlay without reloading map', () => {
  const messages = [];
  globalThis.window = { parent: { postMessage: (...args) => messages.push(args) }, location: { href: 'https://example.test/?__information_modal=1#/information', origin: 'https://example.test' } };
  navigateMapPage();
  assert.deepEqual(messages, [[{ type: 'grid-information-close' }, 'https://example.test']]);
  delete globalThis.window;
});
