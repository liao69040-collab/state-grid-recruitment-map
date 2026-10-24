import { describe, expect, it } from 'vitest';
import {
  enrichAdministrativeRows,
  enrichSchoolRows,
  overlayPrivateDashboard,
  overlayPublicDashboard,
} from '../src/lib/dashboard-overlay.js';

describe('dashboard relational overlay', () => {
  it('adds a Chinese event type label without changing the stored machine code', () => {
    const [row] = enrichAdministrativeRows(
      [{ id: 'event-1', eventType: 'written_exam' }],
      {},
    );
    expect(row).toMatchObject({ eventType: 'written_exam', eventTypeLabel: '笔试' });
  });

  it('deduplicates canonical and provincial batches by code and keeps the sourced plan metric', () => {
    const codes = ['campus', 'batch_1', 'batch_2', 'batch_3'];
    const batches = codes.flatMap((code, index) => [
      {
        id: `canonical-${code}`,
        code,
        name: code,
        cohortYear: 2026,
        publicationStatus: 'published',
        sortOrder: index,
        sourceKeys: [`canonical-source-${code}`],
      },
      {
        id: `provincial-${code}`,
        code,
        name: code,
        cohortYear: 2026,
        publicationStatus: 'published',
        sortOrder: index,
        sourceKeys: [`provincial-source-${code}`],
      },
    ]);
    const metrics = [
      {
        id: 'plan-batch-1',
        batchId: 'canonical-batch_1',
        cohortYear: 2026,
        batchCode: 'batch_1',
        aggregationGrain: 'cohort_batch_company',
        metricType: 'plan_count',
        value: '880',
        isApproximate: true,
      },
    ];

    const result = overlayPrivateDashboard(
      {
        scope: { cohort: '2026届' },
        schools: [],
        batches: codes.map((code) => ({ batch_code: code, plan_count: null })),
      },
      { schools: [], metrics, batches },
    );

    expect(result.batches).toHaveLength(4);
    expect(new Set((result.batches as Array<{ batch_code: string }>).map((row) => row.batch_code)).size).toBe(4);
    expect((result.batches as Array<Record<string, unknown>>).find((row) => row.batch_code === 'batch_1')).toMatchObject({
      plan_count: 880,
      is_approximate: true,
      source_ids: ['canonical-source-batch_1', 'provincial-source-batch_1'],
    });
  });

  it('keeps the public and private Hubei dashboard isolated from other province outcomes', () => {
    const school = {
      id: 'school-sanxia', schoolKey: 'MOE-4142011075', name: '三峡大学',
      publicationStatus: 'published',
    };
    const metric = (
      id: string,
      unitScope: string,
      batchCode: string,
      value: number | null,
      privacySuppressed = false,
    ) => ({
      id, schoolId: school.id, cohortYear: 2026, destinationScope: 'province_company',
      disciplineGroup: 'all', metricType: 'public_notice_record_count', batchCode,
      aggregationGrain: batchCode === 'all' ? 'cohort_school' : 'cohort_batch_school',
      unitScope, value, privacySuppressed, sourceKeys: ['public-selection-aggregate-2026'],
    });
    const metrics = [
      metric('henan-total', '国网河南省电力公司', 'all', 999),
      metric('hubei-total', '国网湖北省电力有限公司', 'all', 267),
      metric('hubei-b1', '国网湖北省电力有限公司', 'batch_1', 190),
      metric('hubei-b2', '国网湖北省电力有限公司', 'batch_2', null, true),
      metric('hubei-b3', '国网湖北省电力有限公司', 'batch_3', 28),
    ];

    const privateResult = overlayPrivateDashboard(
      { scope: { cohort: '2026届' }, schools: [], batches: [] },
      { schools: [school], metrics, batches: [] },
    );
    const privateSchool = (privateResult.schools as Array<Record<string, any>>)[0]!;
    expect(privateSchool.record_count).toBe(267);
    expect(privateSchool.batch_counts).toMatchObject({
      batch_1: { record_count: 190 },
      batch_2: { record_count: null, privacy_suppressed: true },
      batch_3: { record_count: 28 },
    });

    const publicResult = overlayPublicDashboard(
      { scope: { cohort: '2026届' }, hubei: { school_summary: { items: [] }, batch_summary: { items: [] } } },
      { schools: [school], metrics, batches: [] },
    );
    const publicSchools = ((publicResult.hubei as Record<string, any>).school_summary.items) as Array<Record<string, unknown>>;
    expect(publicSchools).toHaveLength(1);
    expect(publicSchools[0]?.record_count).toBe(267);
  });

  it('separates school origin from a selected destination and honors the requested cohort', () => {
    const school = {
      id: 'school-sanxia', schoolKey: 'MOE-4142011075', name: '三峡大学',
      provinceId: 'province-hubei', cityId: 'city-yichang', publicationStatus: 'published',
    };
    const dimensions = {
      provinces: [
        { id: 'province-hubei', adcode: '420000', name: '湖北省' },
        { id: 'province-hunan', adcode: '430000', name: '湖南省' },
      ],
      cities: [{ id: 'city-yichang', name: '宜昌市', provinceId: 'province-hubei' }],
      companies: [
        { id: 'company-hubei', name: '国网湖北省电力有限公司', provinceId: 'province-hubei' },
        { id: 'company-hunan', name: '国网湖南省电力有限公司', provinceId: 'province-hunan' },
      ],
    };
    const metric = (
      id: string,
      cohortYear: number,
      provinceId: string | null,
      companyId: string | null,
      unitScope: string,
      batchCode: string,
      value: number,
      destinationScope = 'province_company',
    ) => ({
      id, schoolId: school.id, cohortYear, provinceId, companyId, unitScope, batchCode, value,
      destinationScope, disciplineGroup: 'all', disciplineEvidenceStatus: 'source_not_provided',
      majorEvidenceStatus: 'source_not_provided', metricType: 'public_notice_record_count',
      aggregationGrain: batchCode === 'all' ? 'cohort_school' : 'cohort_batch_school',
    });
    const metrics = [
      metric('national-2026', 2026, null, null, '国家电网', 'all', 811, 'network_total'),
      {
        ...metric('hubei-2026', 2026, 'province-hubei', 'company-hubei', '国网湖北省电力有限公司', 'all', 267),
        metadata: {
          mapping_methods: ['official_unit_exact', 'source_unit_region_to_parent_scope'],
          source_unit_labels: ['国网湖北省电力有限公司', '湖北电网'],
        },
      },
      metric('hunan-2026', 2026, 'province-hunan', 'company-hunan', '国网湖南省电力有限公司', 'all', 31),
      metric('hunan-2026-b1', 2026, 'province-hunan', 'company-hunan', '国网湖南省电力有限公司', 'batch_1', 20),
      metric('hunan-2025', 2025, 'province-hunan', 'company-hunan', '国网湖南省电力有限公司', 'all', 18),
    ];

    const [defaultRow] = enrichSchoolRows([school], metrics, dimensions);
    expect(defaultRow).toMatchObject({
      schoolProvinceName: '湖北省', schoolCityName: '宜昌市',
      nationalGridRecordCount: 811, targetDestinationName: '湖北省国网相关单位去向汇总',
      targetDestinationCompanyName: null,
      targetDestinationScope: '省级去向汇总口径',
      targetDestinationMappingStatus: '包含省级范围映射',
      targetGridRecordCount: 267,
    });

    const [hunanRow] = enrichSchoolRows([school], metrics, dimensions, {
      cohortYear: 2026,
      destinationProvinceId: 'province-hunan',
    });
    expect(hunanRow).toMatchObject({
      metricCohortYear: 2026,
      targetDestinationName: '湖南省国网相关单位去向汇总',
      targetDestinationCompanyName: null,
      targetDestinationScope: '省级去向汇总口径',
      targetGridRecordCount: 31,
      targetCampusRecordCount: null,
      targetCampusDataStatus: '源数据未提供·待补',
      targetBatch1RecordCount: 20,
      targetDisciplineEvidenceStatus: '源数据未提供·待补',
    });

    const [hubeiCompanyRow] = enrichSchoolRows([school], metrics, dimensions, {
      cohortYear: 2026,
      destinationCompanyId: 'company-hubei',
    });
    expect(hubeiCompanyRow).toMatchObject({
      targetDestinationName: '国网湖北省电力有限公司关联省级去向汇总',
      targetDestinationCompanyName: '国网湖北省电力有限公司',
      targetDestinationScope: '单位关联的省级映射汇总口径',
      targetDestinationMappingStatus: '包含省级范围映射',
      targetGridRecordCount: 267,
    });
  });
});
