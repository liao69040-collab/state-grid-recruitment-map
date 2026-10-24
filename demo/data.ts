/** Deterministic fictional data. No recruitment roster or real school is used. */
import { gridChecksum, gridDatasetSchema } from '../platform/api/src/lib/grid-query.ts';
import { gridMapCatalogSchema } from '../platform/api/src/lib/grid-map-catalog.ts';

export const demoRegions = [
  { adcode: '420000', name: '湖北省', city: '武汉市', cityAdcode: '420100', longitude: 114.30, latitude: 30.59 },
  { adcode: '330000', name: '浙江省', city: '杭州市', cityAdcode: '330100', longitude: 120.16, latitude: 30.25 },
  { adcode: '440000', name: '广东省', city: '广州市', cityAdcode: '440100', longitude: 113.26, latitude: 23.13 },
] as const;

export function createDemoData() {
  const sourceKey = 'demo.synthetic';
  const schools = Array.from({ length: 240 }, (_, i) => ({
    number: i + 1, key: `demo.school.${i + 1}`,
    name: `演示院校 ${String(i + 1).padStart(3, '0')}`,
    region: demoRegions[i % demoRegions.length]!,
    tier: i % 5 === 0 ? '211' : '普通本科',
    ownership: i % 4 === 0 ? '民办' : '公办',
  }));
  const batchCodes = ['batch_1', 'batch_2', 'batch_3', 'csg_autumn', 'csg_spring'] as const;
  const schoolOutcomes = schools.flatMap((school, i) => batchCodes.map((batchCode, batch) => {
    const destination = demoRegions[batch < 3 ? (i + batch) % 2 : 2]!;
    const grid = batch < 3 ? 'sgcc' : 'csg';
    return {
      outcomeKey: `${school.key}.${batchCode}`, sourceKey, cohortYear: 2026, grid, batchCode,
      province: destination.name, city: null,
      companyKey: `demo.company.${destination.adcode}.${grid}`,
      company: `${destination.name}演示电网单位`, orgCategory: 'province_company',
      parentSchoolKey: school.key, schoolName: school.name, campusKey: school.key,
      campusName: school.name, schoolTier: school.tier, educationLevel: '本科',
      schoolOwnership: school.ownership, schoolProvince: school.region.name, industryTags: [],
      metricType: 'public_notice_record_count', recordCount: (240 - i) * (5 - batch) + (i + batch) % 7 + 5,
      evidenceLocator: 'demo/data.ts · 虚构演示数据，不代表实际录用人数',
    };
  }));
  const dataset = gridDatasetSchema.parse({
    schemaVersion: 'grid-query-1', datasetKey: 'grid-atlas-fictional-demo', version: 'demo-1',
    title: 'Grid Atlas 合成演示数据', createdAt: '2026-01-01T00:00:00Z',
    sources: [{ sourceKey, title: '程序生成的虚构学校与录用统计', sourceType: 'roster_aggregate',
      sha256: gridChecksum(schoolOutcomes), sourceUrl: null, note: '纯合成数据；不含真实学校、学生或招聘事实。' }],
    policyFacts: demoRegions.map((region, i) => ({
      factKey: `demo.fact.${i}`, sourceKey, cohortYear: 2026, grid: i === 2 ? 'csg' : 'sgcc',
      batchCode: i === 2 ? 'csg_autumn' : 'batch_1', scope: 'province', province: region.name,
      city: null, company: null, category: 'other', title: '演示资料说明',
      text: '本页学校、录用数量与属性由程序生成，仅用于体验筛选和排名。请自行接入具有授权的数据。',
      educationLevel: null, schoolTier: null, evidenceLocator: 'demo/data.ts',
      dataStatus: 'reference', issueReason: null, relatedOfficialSourceKey: null,
    })),
    schoolOutcomes, notes: ['SYNTHETIC DEMO ONLY — NOT REAL RECRUITMENT DATA'],
  });
  const catalog = gridMapCatalogSchema.parse({
    schemaVersion: 'grid-map-catalog-1', datasetKey: dataset.datasetKey, rosterVersion: dataset.version,
    version: 'demo-map-1', rosterChecksumSha256: gridChecksum(dataset),
    schoolAliases: schools.map(school => ({
      rawName: school.name, parentSchoolKey: school.key, campusKey: school.key, schoolName: school.name,
      campusName: school.name, tier: school.tier, level: '本科', ownership: school.ownership,
      schoolProvince: school.region.name, schoolCode: `demo-${school.number}`, is985: false,
      is211: school.tier === '211', isDoubleFirst: null, kind: '虚构演示高校', matchStatus: 'synthetic',
      notes: '属性也为合成；不是实际院校认定', sourceUrls: [], historicalLevel: '本科', industryTags: '',
    })),
    unitAliases: [],
    schoolGeography: schools.map(school => ({
      campusKey: school.key, parentSchoolKey: school.key, schoolName: school.name, campusName: school.name,
      schoolCode: `demo-${school.number}`, province: school.region.name, provinceAdcode: school.region.adcode,
      city: school.region.city, cityAdcode: school.region.cityAdcode,
      longitude: school.region.longitude, latitude: school.region.latitude, precision: 'city',
      coordinateSystem: null, address: null, sourceUrls: [], sourceLabel: '演示城市代表点',
      note: '虚构院校放在城市代表点；不是实际校园位置', locationStatus: 'synthetic_city', pendingReason: null,
    })),
    provinces: demoRegions.map(region => ({
      adcode: region.adcode, provinceAdcode: null, name: region.name, longitude: region.longitude,
      latitude: region.latitude, coordinateSystem: null, precision: 'province', sourceLabel: '演示区域',
      sourceFile: 'demo/data.ts', sourceProperty: null,
    })),
    cities: demoRegions.map(region => ({
      adcode: region.cityAdcode, provinceAdcode: region.adcode, name: region.city,
      longitude: region.longitude, latitude: region.latitude, coordinateSystem: null, precision: 'city',
      sourceLabel: '演示城市代表点', sourceFile: 'demo/data.ts', sourceProperty: null,
    })),
    sources: [{ sourceKey, title: '合成学校地域目录', sourceUrl: null, note: '仅供软件演示' }],
  });
  return { dataset, catalog, schools };
}
