import { describe, expect, it } from 'vitest';
import { buildProvinceRecruitmentProfile } from '../src/lib/province-recruitment-profile.js';

describe('province recruitment profile DTO', () => {
  it('sorts requirements by business batch and category order', () => {
    const requirement = (requirementKey: string, batchCode: string, category: string) => ({
      requirementKey,
      companyId: 'c-hubei',
      cohortYear: 2026,
      batchCode,
      category,
    });
    const result = buildProvinceRecruitmentProfile({
      province: { id: 'p-hubei', adcode: '420000', name: '湖北省' },
      companies: [{
        id: 'c-hubei',
        companyKey: 'UNIT-HUBEI',
        name: '国网湖北省电力有限公司',
        companyType: 'state_grid_provincial_unit',
      }],
      batches: [],
      events: [],
      requirements: [
        requirement('batch-3-education', 'batch_3', 'education'),
        requirement('campus-education', 'campus', 'education'),
        requirement('batch-1-education', 'batch_1', 'education'),
        requirement('campus-materials', 'campus', 'application_materials'),
        requirement('batch-2-materials', 'batch_2', 'application_materials'),
        requirement('campus-major', 'campus', 'major'),
        requirement('batch-1-materials', 'batch_1', 'application_materials'),
      ],
      revisions: [],
      sources: [],
    });

    expect(result.units[0].requirements.map((row: any) => row.requirementKey)).toEqual([
      'campus-materials',
      'campus-major',
      'campus-education',
      'batch-1-materials',
      'batch-1-education',
      'batch-2-materials',
      'batch-3-education',
    ]);
  });

  it('keeps date-only events, evidence tiers and two Hebei units separate', () => {
    const province = { id: 'p-hebei', adcode: '130000', name: '河北省' };
    const companies = [
      { id: 'c-hebei', companyKey: 'UNIT-HEBEI', name: '国网河北省电力有限公司', companyType: 'state_grid_provincial_unit' },
      { id: 'c-jibei', companyKey: 'UNIT-JIBEI', name: '国网冀北电力有限公司', companyType: 'state_grid_provincial_unit' },
    ];
    const batches = companies.map((company) => ({
      id: `b-${company.id}`,
      companyId: company.id,
      cohortYear: 2026,
      code: 'batch_1',
      sourceKeys: ['sgcc-bullet-test'],
    }));
    const events = [
      {
        id: 'e-earliest', companyId: 'c-hebei', cohortYear: 2026, batchCode: 'batch_1',
        title: '公告发布', startsOn: '2025-09-18', startsAt: new Date('2025-09-17T16:00:00.000Z'),
        evidenceTier: 'A', sourceKind: 'currentOfficialPage', locationText: null,
        sourceKeys: ['sgcc-bullet-test'], publicationStatus: 'published',
      },
      {
        id: 'e-current', companyId: 'c-hebei', cohortYear: 2026, batchCode: 'batch_1',
        title: '笔试日期', startsOn: '2025-12-07', startsAt: null,
        evidenceTier: 'A', sourceKind: 'currentOfficialPage', locationText: '保定考点',
        sourceKeys: ['sgcc-bullet-test'], publicationStatus: 'published',
      },
      {
        id: 'e-history', companyId: 'c-jibei', cohortYear: 2026, batchCode: 'batch_1',
        title: '历史恢复面试', startsOn: '2025-12-08', startsAt: null,
        evidenceTier: 'B', sourceKind: 'historical_recovered', locationText: null,
        sourceKeys: ['sgcc-bullet-test'], publicationStatus: 'published',
      },
    ];
    const result = buildProvinceRecruitmentProfile({
      province,
      companies,
      batches,
      events,
      requirements: [],
      metrics: [
        {
          id: 'm-plan', metricKey: 'HC-HEBEI-B1-001', companyId: 'c-hebei', cohortYear: 2026,
          batchCode: 'batch_1', metricType: 'planned_headcount_raw_mention', valueKind: 'official_announcement_mention',
          aggregationGrain: 'stated_batch_or_scope_total', value: '370', displayValue: '约370人', unit: 'people',
          isApproximate: true, subjectScope: '第一批招聘计划', sourceDocumentId: 's1',
          sourceKeys: ['sgcc-bullet-test'], status: 'verified_current_official_mention', publicationStatus: 'published',
          metadata: {
            paragraphIndex: 8,
            sum_safe: false,
            relation_hint: '公告原文提及，不与分项自动相加。',
            evidence_excerpt: '第一批计划招聘约370人。',
            evidence_locator: '公告正文第9段',
          },
        },
      ],
      revisions: [
        { revisionKey: 'r1', status: 'published', cohortYear: 2026, payload: {}, metadata: { unit_key: 'UNIT-HEBEI', as_of: '2026-08-14', source_keys: ['sgcc-bullet-test', 'sgcc-national-outline'] } },
        { revisionKey: 'r2', status: 'published', cohortYear: 2026, payload: {}, metadata: { unit_key: 'UNIT-JIBEI', as_of: '2026-08-14' } },
      ],
      sources: [
        { id: 's1', sourceKey: 'sgcc-bullet-test', title: '官方公告', sourceType: 'current_official_page', publishedAt: new Date('2025-12-07T00:00:00+08:00') },
        { id: 's2', sourceKey: 'sgcc-national-outline', title: '全国考试大纲', sourceType: 'national_official_attachment', publishedAt: new Date('2025-10-18T00:00:00+08:00') },
      ],
      filters: { cohortYear: 2026 },
    });
    expect(result.summary).toMatchObject({ unitCount: 2, eventCount: 3, headcountMentionCount: 1 });
    expect(result.units[0].company.name).not.toBe(result.units[1].company.name);
    const current = result.units.find((unit: any) => unit.company.companyKey === 'UNIT-HEBEI');
    const historical = result.units.find((unit: any) => unit.company.companyKey === 'UNIT-JIBEI');
    expect(current.events.map((event: any) => event.id)).toEqual(['e-earliest', 'e-current']);
    expect(current.events[1]).toMatchObject({ startsOn: '2025-12-07', startsAt: null });
    expect(current.summary).toMatchObject({ currentOfficialEventCount: 2, preciseTimeEventCount: 1, sourceCount: 2, headcountMentionCount: 1 });
    expect(current.headcountFacts[0]).toMatchObject({
      headcountKey: 'HC-HEBEI-B1-001',
      displayValue: '约370人',
      sumSafe: false,
      evidenceTier: 'A',
      sourceKeys: ['sgcc-bullet-test'],
    });
    expect(current.sources.every((source: any) => source.evidenceTier === 'A')).toBe(true);
    expect(current.sources[0].sourceKey).toBe('sgcc-bullet-test');
    expect(current.sources.map((source: any) => source.sourceKey)).toContain('sgcc-national-outline');
    expect(historical.summary).toMatchObject({ historicalEventCount: 1 });
    expect(result.boundaries.join(' ')).toContain('河北与冀北');
  });
});
