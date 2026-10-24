import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.js';

describe('admin business grouping order', () => {
  it('keeps every grouped resource in province/city/company/batch business order', async () => {
    const store = new MemoryStore();
    const create = (resource: Parameters<MemoryStore['createResource']>[0], input: Record<string, unknown>) =>
      store.createResource(resource, input, 'seed');

    const lateProvince = await create('provinces', {
      provinceKey: 'PROV-LATE', adcode: '990000', name: '后置省', sortOrder: 20,
    });
    const earlyProvince = await create('provinces', {
      provinceKey: 'PROV-EARLY', adcode: '110000', name: '优先省', sortOrder: 1,
    });
    const lateCity = await create('cities', {
      cityKey: 'CITY-LATE', name: '后置市', provinceId: lateProvince.id, sortOrder: 1,
    });
    const earlyCityB = await create('cities', {
      cityKey: 'CITY-EARLY-B', name: '乙市', provinceId: earlyProvince.id, sortOrder: 2,
    });
    const earlyCityA = await create('cities', {
      cityKey: 'CITY-EARLY-A', name: '甲市', provinceId: earlyProvince.id, sortOrder: 1,
    });

    await create('schools', {
      schoolKey: 'SCHOOL-LATE', name: '后置大学', provinceId: lateProvince.id, cityId: lateCity.id,
    });
    await create('schools', {
      schoolKey: 'SCHOOL-EARLY-B', name: '乙市大学', provinceId: earlyProvince.id, cityId: earlyCityB.id,
    });
    const earlySchool = await create('schools', {
      schoolKey: 'SCHOOL-EARLY-A', name: '甲市大学', provinceId: earlyProvince.id, cityId: earlyCityA.id,
    });

    const lateCompany = await create('companies', {
      companyKey: 'COMPANY-LATE', name: '后置单位', provinceId: lateProvince.id, cityId: lateCity.id,
    });
    const earlyCompanyB = await create('companies', {
      companyKey: 'COMPANY-EARLY-B', name: '乙单位', provinceId: earlyProvince.id, cityId: earlyCityB.id,
    });
    const earlyCompanyA = await create('companies', {
      companyKey: 'COMPANY-EARLY-A', name: '甲单位', provinceId: earlyProvince.id, cityId: earlyCityA.id,
    });

    const batch2 = await create('recruitment-batches', {
      batchKey: 'BATCH-EARLY-A-2', cohortYear: 2026, code: 'batch_2', name: '第二批',
      provinceId: earlyProvince.id, companyId: earlyCompanyA.id, sortOrder: 2,
    });
    const batch1 = await create('recruitment-batches', {
      batchKey: 'BATCH-EARLY-A-1', cohortYear: 2026, code: 'batch_1', name: '第一批',
      provinceId: earlyProvince.id, companyId: earlyCompanyA.id, sortOrder: 1,
    });
    await create('recruitment-batches', {
      batchKey: 'BATCH-EARLY-B-1', cohortYear: 2026, code: 'batch_1', name: '第一批',
      provinceId: earlyProvince.id, companyId: earlyCompanyB.id, sortOrder: 1,
    });
    await create('recruitment-batches', {
      batchKey: 'BATCH-LATE-1', cohortYear: 2026, code: 'batch_1', name: '第一批',
      provinceId: lateProvince.id, companyId: lateCompany.id, sortOrder: 1,
    });

    await create('recruitment-metrics', {
      metricKey: 'METRIC-BATCH-2', cohortYear: 2026, batchCode: 'batch_2', batchId: batch2.id,
      provinceId: earlyProvince.id, companyId: earlyCompanyA.id, schoolId: earlySchool.id,
      metricType: 'public_notice_record_count', disciplineGroup: 'all',
    });
    await create('recruitment-metrics', {
      metricKey: 'METRIC-BATCH-1', cohortYear: 2026, batchCode: 'batch_1', batchId: batch1.id,
      provinceId: earlyProvince.id, companyId: earlyCompanyA.id, schoolId: earlySchool.id,
      metricType: 'public_notice_record_count', disciplineGroup: 'all',
    });

    await create('recruitment-events', {
      eventKey: 'EVENT-INTERVIEW', cohortYear: 2026, batchCode: 'batch_1', batchId: batch1.id,
      provinceId: earlyProvince.id, companyId: earlyCompanyA.id, eventType: 'interview',
      startsOn: '2026-01-02', title: '面试',
    });
    await create('recruitment-events', {
      eventKey: 'EVENT-APPLICATION', cohortYear: 2026, batchCode: 'batch_1', batchId: batch1.id,
      provinceId: earlyProvince.id, companyId: earlyCompanyA.id, eventType: 'application',
      startsOn: '2026-01-01', title: '网申',
    });
    await create('recruitment-events', {
      eventKey: 'EVENT-DEADLINE', cohortYear: 2026, batchCode: 'batch_1', batchId: batch1.id,
      provinceId: earlyProvince.id, companyId: earlyCompanyA.id, eventType: 'application_deadline',
      startsOn: '2026-01-01', title: '网申截止',
    });
    await create('recruitment-events', {
      eventKey: 'EVENT-WRITTEN', cohortYear: 2026, batchCode: 'batch_1', batchId: batch1.id,
      provinceId: earlyProvince.id, companyId: earlyCompanyA.id, eventType: 'written_exam',
      startsOn: '2026-01-01', title: '笔试',
    });
    await create('recruitment-events', {
      eventKey: 'EVENT-PENDING-DATE', cohortYear: 2026, batchCode: 'batch_1', batchId: batch1.id,
      provinceId: earlyProvince.id, companyId: earlyCompanyA.id, eventType: 'public_notice',
      startsOn: null, startsAt: null, title: '日期待官方补充',
    });

    await create('recruitment-requirements', {
      requirementKey: 'REQ-EDUCATION', cohortYear: 2026, batchCode: 'batch_1',
      provinceId: earlyProvince.id, companyId: earlyCompanyA.id, category: 'education',
      title: '学历要求', evidenceLocator: 'p2',
    });
    await create('recruitment-requirements', {
      requirementKey: 'REQ-MATERIALS', cohortYear: 2026, batchCode: 'batch_1',
      provinceId: earlyProvince.id, companyId: earlyCompanyA.id, category: 'application_materials',
      title: '报名材料', evidenceLocator: 'p1',
    });

    const list = (resource: Parameters<MemoryStore['listResource']>[0]) =>
      store.listResource(resource, { limit: 100, offset: 0 });

    expect((await list('cities')).items.map((row) => row.cityKey)).toEqual([
      'CITY-EARLY-A', 'CITY-EARLY-B', 'CITY-LATE',
    ]);
    expect((await list('schools')).items.map((row) => row.schoolKey)).toEqual([
      'SCHOOL-EARLY-A', 'SCHOOL-EARLY-B', 'SCHOOL-LATE',
    ]);
    expect((await list('companies')).items.map((row) => row.companyKey)).toEqual([
      'COMPANY-EARLY-A', 'COMPANY-EARLY-B', 'COMPANY-LATE',
    ]);
    expect((await list('recruitment-batches')).items.map((row) => row.batchKey)).toEqual([
      'BATCH-EARLY-A-1', 'BATCH-EARLY-A-2', 'BATCH-EARLY-B-1', 'BATCH-LATE-1',
    ]);
    expect((await list('recruitment-metrics')).items.map((row) => row.metricKey)).toEqual([
      'METRIC-BATCH-1', 'METRIC-BATCH-2',
    ]);
    expect((await list('recruitment-events')).items.map((row) => row.eventKey)).toEqual([
      'EVENT-APPLICATION', 'EVENT-DEADLINE', 'EVENT-WRITTEN', 'EVENT-INTERVIEW', 'EVENT-PENDING-DATE',
    ]);
    expect((await list('recruitment-requirements')).items.map((row) => row.requirementKey)).toEqual([
      'REQ-MATERIALS', 'REQ-EDUCATION',
    ]);
  });

  it('filters schools by sourced cohort and destination facts instead of the school dimension', async () => {
    const store = new MemoryStore();
    const create = (resource: Parameters<MemoryStore['createResource']>[0], input: Record<string, unknown>) =>
      store.createResource(resource, input, 'seed');

    const hubei = await create('provinces', {
      provinceKey: 'PROV-HUBEI', adcode: '420000', name: '湖北省', sortOrder: 1,
    });
    const hunan = await create('provinces', {
      provinceKey: 'PROV-HUNAN', adcode: '430000', name: '湖南省', sortOrder: 2,
    });
    const hubeiCompany = await create('companies', {
      companyKey: 'COMPANY-HUBEI', name: '国网湖北省电力有限公司', provinceId: hubei.id,
    });
    const hunanCompany = await create('companies', {
      companyKey: 'COMPANY-HUNAN', name: '国网湖南省电力有限公司', provinceId: hunan.id,
    });
    const school = await create('schools', {
      schoolKey: 'SCHOOL-TEST', name: '测试大学', provinceId: hubei.id,
      // The school dimension deliberately has no cohort year; cohort is a metric fact.
      cohortYear: null,
    });
    const hubeiId = String(hubei.id);
    const hunanId = String(hunan.id);
    const hubeiCompanyId = String(hubeiCompany.id);
    const hunanCompanyId = String(hunanCompany.id);
    const metric = (metricKey: string, cohortYear: number, provinceId: string, companyId: string, value: number) =>
      create('recruitment-metrics', {
        metricKey, cohortYear, provinceId, companyId, schoolId: school.id,
        destinationScope: 'province_company', aggregationGrain: 'cohort_school',
        batchCode: 'all', disciplineGroup: 'all', metricType: 'public_notice_record_count',
        value, publicationStatus: 'published',
      });
    await metric('METRIC-HUBEI-2026', 2026, hubeiId, hubeiCompanyId, 12);
    await metric('METRIC-HUNAN-2025', 2025, hunanId, hunanCompanyId, 8);

    const hubei2026 = await store.listResource('schools', {
      cohortYear: 2026, destinationProvinceId: hubeiId, limit: 20, offset: 0,
    });
    expect(hubei2026.total).toBe(1);
    expect(hubei2026.items[0]).toMatchObject({
      schoolKey: 'SCHOOL-TEST', metricCohortYear: 2026,
      targetDestinationName: '湖北省国网相关单位去向汇总',
      targetDestinationScope: '省级去向汇总口径',
      targetGridRecordCount: 12,
    });

    const hubeiCompany2026 = await store.listResource('schools', {
      cohortYear: 2026, destinationCompanyId: hubeiCompanyId, limit: 20, offset: 0,
    });
    expect(hubeiCompany2026.total).toBe(1);
    expect(hubeiCompany2026.items[0]).toMatchObject({
      targetDestinationName: '国网湖北省电力有限公司',
      targetDestinationScope: '单位映射口径',
      targetGridRecordCount: 12,
    });

    const hunan2026 = await store.listResource('schools', {
      cohortYear: 2026, destinationProvinceId: hunanId, limit: 20, offset: 0,
    });
    expect(hunan2026).toMatchObject({ total: 0, items: [] });

    const hunan2025 = await store.listResource('schools', {
      cohortYear: 2025, destinationCompanyId: hunanCompanyId, limit: 20, offset: 0,
    });
    expect(hunan2025.total).toBe(1);
    expect(hunan2025.items[0]).toMatchObject({ metricCohortYear: 2025, targetGridRecordCount: 8 });
  });
});
