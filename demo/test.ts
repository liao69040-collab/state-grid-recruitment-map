import assert from 'node:assert/strict';
import { createDemoApp, DEMO_ADMIN_USERNAME, DEMO_PASSWORD, DEMO_USER_PHONE } from './app.ts';

const { app, data } = await createDemoApp();
let checks = 0;
function check(condition: unknown, message: string) { assert.ok(condition, message); checks += 1; }
const origin = 'http://127.0.0.1:8112';
try {
  check((await app.inject({ url: '/healthz' })).statusCode === 200, 'health');
  const anonymous = await app.inject({ url: '/api/v2/private/grid-aggregates/rankings?view=campus' });
  check(anonymous.statusCode === 401, 'member rankings remain protected');
  const publicMap = await app.inject({ url: '/api/v2/public/grid-map/overview?cohortYear=2026' });
  check(publicMap.statusCode === 200, 'public map preview');
  const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', headers: { origin },
    payload: { phone: DEMO_USER_PHONE, password: DEMO_PASSWORD } });
  check(login.statusCode === 200, 'demo member can log in');
  const cookie = login.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const headers = { cookie, origin };
  const first = await app.inject({ url: '/api/v2/private/grid-aggregates/rankings?view=campus&cohortYear=2026&pageSize=100&page=1', headers });
  const second = await app.inject({ url: '/api/v2/private/grid-aggregates/rankings?view=campus&cohortYear=2026&pageSize=100&page=2', headers });
  check(first.statusCode === 200 && second.statusCode === 200, 'two bounded ranking pages');
  const page1 = first.json(), page2 = second.json();
  check(page1.total === 240 && page1.items.length === 100 && page2.items.length === 100, 'Top 200 from 240 fictional schools');
  check(new Set([...page1.items, ...page2.items].map(row => row.schoolKey)).size === 200, 'no overlapping schools across pages');
  const local = await app.inject({ url: '/api/v2/private/grid-aggregates/rankings?view=campus&cohortYear=2026&schoolProvinceAdcode=420000&pageSize=100', headers });
  check(local.statusCode === 200 && local.json().total === 80, '80 Hubei-located fictional schools');
  const inbound = await app.inject({ url: '/api/v2/private/grid-aggregates/rankings?view=campus&cohortYear=2026&province=湖北省&pageSize=100', headers });
  check(inbound.statusCode === 200 && inbound.json().total === 240, '240 fictional schools hired into Hubei');
  const rows = data.dataset.schoolOutcomes.filter(row => row.campusKey === 'demo.school.1');
  const nationalTotal = rows.reduce((n, row) => n + row.recordCount, 0);
  const hubeiTotal = rows.filter(row => row.province === '湖北省').reduce((n, row) => n + row.recordCount, 0);
  check(local.json().items[0].recordCount === nationalTotal, 'school location ranking uses nationwide totals');
  check(inbound.json().items[0].recordCount === hubeiTotal && hubeiTotal < nationalTotal, 'destination ranking stays separate');
  const detail = await app.inject({ url: '/api/v2/private/grid-aggregates/schools/demo.school.1?cohortYear=2026&provinceAdcode=420000', headers });
  check(detail.statusCode === 200, 'school detail');
  check(detail.json().recruitmentSummary.national.recordCount === nationalTotal, 'detail reconciles with national ranking');
  check(Object.keys(detail.json().recruitmentSummary.national.batchCounts).length === 5, 'five grid-native batches');
  check(detail.json().recruitmentSummary.targetProvince.recordCount === hubeiTotal, 'detail target province reconciles');
  const adminLogin = await app.inject({ method: 'POST', url: '/api/v2/admin/auth/login', headers: { origin },
    payload: { username: DEMO_ADMIN_USERNAME, password: DEMO_PASSWORD } });
  check(adminLogin.statusCode === 200, 'demo admin can log in');
  const adminCookie = adminLogin.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  check((await app.inject({ url: '/api/v2/admin/auth/me', headers: { cookie: adminCookie } })).statusCode === 200, 'admin session');
  check((await app.inject({ url: '/api/v2/admin/auth/me', headers })).statusCode === 401, 'member does not become admin');
  check((await app.inject({ url: '/api/v2/private/grid-query/original-html', headers })).statusCode === 503, 'private historical source is absent');
  console.log(`DEMO_TEST_OK ${checks} assertions; synthetic schools=240; no database or private source files required.`);
} finally { await app.close(); }
