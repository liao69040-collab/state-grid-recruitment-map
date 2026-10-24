import { describe, expect, it } from 'vitest';
import { recruitmentDisplayText, recruitmentDisplayTitle, recruitmentFactForDisplay, recruitmentTextIssues } from '../src/lib/recruitment-display-text.js';
import { gridDatasetSchema, gridFactQuerySchema, gridVersion, queryGridFacts } from '../src/lib/grid-query.js';
import { importGridDataset } from '../src/lib/grid-query-import.js';

const imageFormula = '=DISPIMG("ID_A2B6C69AAF734597AD5BCB29CFC72E9C",1)';
function fixture() {
  return gridDatasetSchema.parse({ schemaVersion: 'grid-query-1', datasetKey: 'fixture', version: 'v1', title: '测试', createdAt: '2026-09-23T00:00:00.000Z', notes: [],
    sources: [{ sourceKey: 'excel', title: '测试资料', sourceType: 'user_material', sha256: 'a'.repeat(64), sourceUrl: null, note: '' }], schoolOutcomes: [],
    policyFacts: [
      { factKey: 'image', sourceKey: 'excel', cohortYear: 2026, grid: 'sgcc', batchCode: 'campus', scope: 'province', province: '重庆', city: null, company: null, category: 'other', title: '备注', text: imageFormula, educationLevel: null, schoolTier: null, evidenceLocator: 'Sheet1!I6', dataStatus: 'reference', issueReason: null, relatedOfficialSourceKey: null },
      { factKey: 'mixed', sourceKey: 'excel', cohortYear: 2026, grid: 'sgcc', batchCode: 'campus', scope: 'province', province: '重庆', city: null, company: null, category: 'education', title: '招聘要求', text: `本科及以上\n${imageFormula}`, educationLevel: null, schoolTier: null, evidenceLocator: 'Sheet1!C6', dataStatus: 'reference', issueReason: null, relatedOfficialSourceKey: null },
    ],
  });
}
describe('reading text projection and source-preserving import guard', () => {
  it('removes image formulas/errors while retaining adjacent actual conditions', () => {
    expect(recruitmentDisplayText(imageFormula)).toBe('');
    expect(recruitmentDisplayText(`本科及以上\n${imageFormula}\n专业：电工类`)).toBe('本科及以上\n专业：电工类');
    expect(recruitmentDisplayText('=_xlfn.DISPIMG("ID_A",1)')).toBe('');
    expect(recruitmentDisplayText('#REF!\n2026届')).toBe('2026届');
    expect(recruitmentDisplayText('备\uFFFD注\n电工类')).toBe('电工类');
    expect(recruitmentDisplayText({ object: true })).toBe('');
  });
  it('keeps valid units, dates, restrictions and semantic operators unchanged', () => {
    for (const value of ['本科及以上，年龄≤25岁', '2026年7月31日前取得毕业证', '20—25万元/年', 'CET-4 425分；QS前100', '2024年报录比28:1，报名1234人次']) expect(recruitmentDisplayText(value)).toBe(value);
    expect(recruitmentTextIssues('本科及以上，年龄≤25岁')).toEqual([]);
  });
  it('relabels metrics and hides importer-only commentary, not underlying measurements', () => {
    expect(recruitmentDisplayTitle('HTML报名汇总参考')).toBe('报名数量');
    expect(recruitmentDisplayText('一批 / 全部；计划 未提供；报名 20061；比值 未提供。\n报招比：报名人次/计划数（按渲染器标签），不等于去重自然人数。')).toBe('一批 / 全部；报名 20061。');
    expect(recruitmentDisplayText('三批 / 农电；计划 60；资料录用 88；报录比原文 未提供。\n与名单主榜分开，不相加、不覆盖。')).toBe('三批 / 农电；计划 60；录用 88。');
  });
  it('does not remove topic-index or experience semantics before grouping', () => {
    expect(recruitmentFactForDisplay({ title: '原文条款：学历 / 招聘要求', text: '本科' }).title).toBe('原文条款：学历 / 招聘要求');
    expect(recruitmentDisplayTitle('原文条款：学历 / 招聘要求')).toBe('学历 · 招聘要求');
  });
  it('filters formula-only facts before pagination and keeps raw audit data unchanged', () => {
    const dataset = fixture(), snapshot = { datasets: [dataset], versions: [gridVersion(dataset)] }, before = JSON.stringify(dataset);
    const member = queryGridFacts(snapshot, gridFactQuerySchema.parse({ pageSize: 1 }));
    expect(member.total).toBe(1); expect(member.items[0]?.text).toBe('本科及以上');
    expect(queryGridFacts(snapshot, gridFactQuerySchema.parse({}), true).items.find(row => row.factKey === 'image')?.text).toBe(imageFormula);
    expect(JSON.stringify(dataset)).toBe(before);
  });
  it('rejects a new published formula import before INSERT and rolls back', async () => {
    const statements: string[] = [];
    const client = { query: async (sql: string) => { statements.push(sql); return { rows: [], rowCount: 0 }; } };
    await expect(importGridDataset(client as never, fixture())).rejects.toThrow('GRID_TEXT_ARTIFACT_REQUIRES_QUARANTINE:image,mixed');
    expect(statements.some(sql => /^\s*(INSERT|UPDATE)\b/.test(sql))).toBe(false);
    expect(statements.at(-1)).toBe('ROLLBACK');
  });
});
