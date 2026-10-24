import { describe, expect, it } from 'vitest';
import {
  evaluateEarlyBatchPolicy,
  type EarlyBatchEligibilityModel,
} from '../src/lib/early-batch.js';
import type { EarlyBatchPolicyRecord } from '../src/store/types.js';

function policy(eligibilityModel: EarlyBatchEligibilityModel): EarlyBatchPolicyRecord {
  const now = new Date('2026-09-03T00:00:00.000Z');
  return {
    id: '00000000-0000-4000-8000-000000000001',
    policyKey: 'EARLY-BATCH-TEST',
    cohortYear: 2026,
    batchCode: 'campus',
    targetKind: 'province',
    targetCode: 'PROV-420000',
    targetName: '湖北',
    provinceId: null,
    parentProvinceId: null,
    provinceAdcode: '420000',
    parentProvinceAdcode: '420000',
    recruitmentRequirements: '测试条件',
    recruitmentProcess: null,
    plannedHeadcountDisplay: null,
    assessmentMethod: null,
    itineraryReference: null,
    siteQuotaDisplay: null,
    admissionRule: null,
    actualHeadcountDisplay: null,
    otherNotes: null,
    missingFields: [],
    eligibilityModel: eligibilityModel as unknown as Record<string, unknown>,
    sourceLocator: 'Sheet1!A3:K3',
    evidenceAssets: [],
    externalEvidence: [],
    sourceStatus: 'uploaded_reference_unverified',
    sourceDocumentId: '00000000-0000-4000-8000-000000000002',
    sourceDocumentTitle: '2026提前批情况.xlsx',
    sourceDocumentKey: 'uploaded-workbook-test',
    sourceDocumentOfficialUrl: null,
    revisionId: '00000000-0000-4000-8000-000000000003',
    revisionKey: 'EARLY-BATCH-2026-TEST',
    revisionDataStatus: 'uploaded_reference_unverified',
    status: 'active',
    publicationStatus: 'published',
    sortOrder: 1,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

const hubeiPolicy = policy({
  version: 1,
  confidence: 'structured_from_uploaded_reference',
  branches: [
    {
      key: 'graduate-school-tier',
      outcome: 'eligible_reference',
      reason: '学历与学校类别符合表内已列正向条件。',
      predicates: [
        { field: 'degree', operator: 'in', value: ['master', 'doctor'], label: '学历阶段' },
        {
          field: 'schoolTags',
          operator: 'contains_any',
          value: ['legacy_985', 'legacy_211', 'former_power_ministry'],
          label: '学校类别',
        },
      ],
    },
  ],
  notes: ['本表不能证明官方明确禁止本科报考。'],
});

describe('early-batch pure evaluator', () => {
  it('returns the four workbook-bounded outcomes without treating them as official decisions', () => {
    expect(
      evaluateEarlyBatchPolicy(hubeiPolicy, {
        degree: 'master',
        schoolTags: ['legacy_985'],
      }).decision,
    ).toBe('eligible_under_workbook_rule');

    expect(evaluateEarlyBatchPolicy(hubeiPolicy, { degree: 'master' }).decision).toBe(
      'missing_input',
    );

    const bachelor = evaluateEarlyBatchPolicy(hubeiPolicy, {
        degree: 'bachelor',
        schoolTags: ['legacy_985'],
      });
    expect(bachelor.decision).toBe('ineligible_under_workbook_rule');
    expect(bachelor.contextNotes).toContain('本表不能证明官方明确禁止本科报考。');

    const manual = policy({
      version: 1,
      confidence: 'incomplete_reference',
      branches: [
        {
          key: 'manual',
          outcome: 'manual_review',
          reason: '源表条件不完整。',
          predicates: [{ field: 'degree', operator: 'in', value: ['master'], label: '学历' }],
        },
      ],
    });
    expect(evaluateEarlyBatchPolicy(manual, { degree: 'master' }).decision).toBe(
      'manual_review',
    );
  });

  it('treats omitted school identity as missing while preserving explicit matches and non-matches', () => {
    const namedSchoolPolicy = policy({
      version: 1,
      confidence: 'structured_from_uploaded_reference',
      branches: [{
        key: 'named-school',
        outcome: 'eligible_reference',
        reason: '学校满足表内条件。',
        predicates: [{
          field: 'schoolIdentity',
          operator: 'matches_any',
          value: ['legacy_985', '华北电力大学'],
          label: '学校类别或指定学校',
        }],
      }],
    });
    const missing = evaluateEarlyBatchPolicy(namedSchoolPolicy, { degree: 'bachelor' });
    expect(missing.decision).toBe('missing_input');
    expect(missing.missingInputs).toContainEqual(expect.objectContaining({ field: 'schoolIdentity' }));
    expect(evaluateEarlyBatchPolicy(namedSchoolPolicy, {
      degree: 'bachelor', schoolName: '华北电力大学',
    }).decision).toBe('eligible_under_workbook_rule');
    expect(evaluateEarlyBatchPolicy(namedSchoolPolicy, {
      degree: 'bachelor', schoolTags: ['legacy_985'],
    }).decision).toBe('eligible_under_workbook_rule');
    expect(evaluateEarlyBatchPolicy(namedSchoolPolicy, {
      degree: 'bachelor', schoolName: '其他学校', schoolTags: [], schoolTagsConfirmed: true,
    }).decision).toBe('ineligible_under_workbook_rule');
    expect(evaluateEarlyBatchPolicy(namedSchoolPolicy, {
      degree: 'bachelor', schoolTags: [], schoolTagsConfirmed: true,
    }).decision).toBe('ineligible_under_workbook_rule');
  });

  it('derives the SuBei language rule from degree and CET inputs on the server', () => {
    const certificatePolicy = policy({
      version: 1,
      confidence: 'conditional_reference',
      branches: [
        {
          key: 'certificate',
          outcome: 'eligible_reference',
          reason: '证书条件符合。',
          predicates: [
            {
              field: 'languageQualification',
              operator: 'meets_degree_rule',
              value: true,
              label: '英语等级',
            },
            {
              field: 'certificatesObtainedBeforeApplication',
              operator: 'equals',
              value: true,
              label: '证书在网申前取得',
            },
          ],
        },
      ],
    });

    expect(
      evaluateEarlyBatchPolicy(certificatePolicy, {
        degree: 'bachelor',
        cet4OrHigher: true,
        cet6OrHigher: false,
        certificatesObtainedBeforeApplication: true,
      }).decision,
    ).toBe('eligible_under_workbook_rule');
    expect(
      evaluateEarlyBatchPolicy(certificatePolicy, {
        degree: 'master',
        cet4OrHigher: true,
        certificatesObtainedBeforeApplication: true,
      }).decision,
    ).toBe('missing_input');
    expect(
      evaluateEarlyBatchPolicy(certificatePolicy, {
        degree: 'master',
        cet6OrHigher: false,
        certificatesObtainedBeforeApplication: true,
      }).decision,
    ).toBe('ineligible_under_workbook_rule');
    expect(
      evaluateEarlyBatchPolicy(certificatePolicy, {
        degree: 'doctor',
        cet6OrHigher: true,
        certificatesObtainedBeforeApplication: true,
      }).decision,
    ).toBe('eligible_under_workbook_rule');
    expect(
      evaluateEarlyBatchPolicy(certificatePolicy, {
        degree: 'bachelor',
        cet4OrHigher: true,
      }).decision,
    ).toBe('missing_input');
  });

  it('routes unsupported operators to manual review', () => {
    const unsupported = policy({
      version: 1,
      confidence: 'manual',
      branches: [
        {
          key: 'unsupported',
          outcome: 'eligible_reference',
          reason: '需人工核验。',
          predicates: [{ field: 'degree', operator: 'unknown', value: 'master', label: '学历' }],
        },
      ],
    });
    expect(evaluateEarlyBatchPolicy(unsupported, { degree: 'master' }).decision).toBe(
      'manual_review',
    );
  });

  it('keeps Fujian\'s unquantified grade wording as an explicit manual-review input', () => {
    const fujian = policy({
      version: 1,
      confidence: 'structured_with_unquantified_grade_rule',
      branches: [
        {
          key: 'graduate-tier-grade',
          outcome: 'manual_review',
          reason: '已列条件可对照，成绩条件需人工核验。',
          predicates: [
            { field: 'degree', operator: 'in', value: ['master'], label: '学历' },
            {
              field: 'gradesAcceptable',
              operator: 'requires_manual_review',
              value: {
                sourceText: '源表Sheet1!K23仅写‘成绩较差’',
                reason: '未给出分数、排名、绩点或课程阈值；本人自评不得转换为自动硬规则',
              },
              label: '福建成绩条件（未量化）',
            },
          ],
        },
      ],
    });

    for (const [gradesAcceptable, expectedInputLabel] of [
      [undefined, '未填写本人成绩自评'],
      [true, '本人自评为“满足”'],
      [false, '本人自评为“可能不满足”'],
    ] as const) {
      const result = evaluateEarlyBatchPolicy(fujian, {
        degree: 'master',
        ...(gradesAcceptable === undefined ? {} : { gradesAcceptable }),
      });
      expect(result.decision).toBe('manual_review');
      expect(result.manualReviewReasons.join(' ')).toContain(expectedInputLabel);
      expect(result.manualReviewReasons.join(' ')).toContain('Sheet1!K23');
      expect(result.manualReviewReasons.join(' ')).toContain('不得转换为自动硬规则');
    }
  });

  it('does not broaden communication into the electronic-information category', () => {
    const communicationOnly = policy({
      version: 1,
      confidence: 'structured_from_uploaded_reference',
      branches: [
        {
          key: 'communication-only',
          outcome: 'eligible_reference',
          reason: '仅限通信类。',
          predicates: [
            {
              field: 'majorCategory',
              operator: 'in',
              value: ['communication'],
              label: '专业类别',
            },
          ],
        },
      ],
    });
    expect(
      evaluateEarlyBatchPolicy(communicationOnly, {
        degree: 'master',
        majorCategory: 'communication',
      }).decision,
    ).toBe('eligible_under_workbook_rule');
    expect(
      evaluateEarlyBatchPolicy(communicationOnly, {
        degree: 'master',
        majorCategory: 'electronic_information',
      }).decision,
    ).toBe('ineligible_under_workbook_rule');
  });
});
