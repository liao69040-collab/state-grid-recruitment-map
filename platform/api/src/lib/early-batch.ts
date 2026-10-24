import type { EarlyBatchPolicyRecord, EarlyBatchSchoolRecord } from '../store/types.js';

export const earlyBatchDecisions = [
  'eligible_under_workbook_rule',
  'ineligible_under_workbook_rule',
  'missing_input',
  'manual_review',
] as const;

export type EarlyBatchDecision = (typeof earlyBatchDecisions)[number];

export const earlyBatchSchoolTags = [
  'legacy_985',
  'legacy_211',
  'former_power_ministry',
  'public_institution',
] as const;

export type EarlyBatchSchoolTag = (typeof earlyBatchSchoolTags)[number];

export type EarlyBatchApplicant = {
  schoolKey?: string | undefined;
  schoolName?: string | undefined;
  schoolProvinceAdcode?: string | undefined;
  schoolTags?: EarlyBatchSchoolTag[] | undefined;
  schoolTagsConfirmed?: boolean | undefined;
  degree: 'bachelor' | 'master' | 'doctor';
  majorCategory?:
    | 'electrical'
    | 'computer'
    | 'communication'
    | 'electronic_information'
    | 'artificial_intelligence'
    | 'finance'
    | 'human_resources'
    | 'law'
    | 'other_engineering'
    | 'other'
    | undefined;
  freshGraduate?: boolean | undefined;
  graduationYear?: number | undefined;
  fullTime?: boolean | undefined;
  computerLevel2?: boolean | undefined;
  cet4OrHigher?: boolean | undefined;
  cet6OrHigher?: boolean | undefined;
  certificatesObtainedBeforeApplication?: boolean | undefined;
  nationalUnifiedAdmission?: boolean | undefined;
  majorMatchesEnrollment?: boolean | undefined;
  age?: number | undefined;
  hasFailedCourses?: boolean | undefined;
  gradesAcceptable?: boolean | undefined;
};

export type EarlyBatchPredicate = {
  field: string;
  operator: string;
  value: unknown;
  label: string;
};

export type EarlyBatchRuleBranch = {
  key: string;
  outcome: 'eligible_reference' | 'manual_review';
  reason: string;
  predicates: EarlyBatchPredicate[];
  notes?: string[];
};

export type EarlyBatchEligibilityModel = {
  version: number;
  confidence: string;
  branches: EarlyBatchRuleBranch[];
  notes?: string[];
};

export type EarlyBatchRequirement = {
  field: string;
  label: string;
  operator: string;
  expected: unknown;
};

export type EarlyBatchPolicyDecision = {
  decision: EarlyBatchDecision;
  basis: 'uploaded_workbook_rule';
  reason: string;
  matchedBranchKey: string | null;
  missingInputs: EarlyBatchRequirement[];
  unmetRequirements: EarlyBatchRequirement[];
  manualReviewReasons: string[];
  contextNotes: string[];
};

export type EarlyBatchSchoolDescriptor = {
  schoolKey: string;
  name: string;
  provinceAdcode: string | null;
  educationLevel: string | null;
  nature: string | null;
  natureStatus: string;
  natureBasis: string | null;
  schoolTags: EarlyBatchSchoolTag[];
  tagSourceStatus: string;
  requiresConfirmation: boolean;
  sourceKeys: string[];
};

export type EarlyBatchSchoolTagBasis =
  | 'dataset_verified'
  | 'user_confirmed'
  | 'unresolved';

type PredicateState = 'pass' | 'fail' | 'missing' | 'manual';

type PredicateResult = {
  state: PredicateState;
  requirement: EarlyBatchRequirement;
  manualReason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function normalizeSchoolName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
}

export function describeEarlyBatchSchool(row: EarlyBatchSchoolRecord): EarlyBatchSchoolDescriptor {
  const tagsValue = isRecord(row.metadata.tags) ? row.metadata.tags : {};
  const tierTagsVerified = tagsValue.status === 'verified';
  const tags: EarlyBatchSchoolTag[] = [];
  if (tierTagsVerified && tagsValue.legacy_985 === true) tags.push('legacy_985');
  if (tierTagsVerified && tagsValue.legacy_211 === true) tags.push('legacy_211');
  if (
    tierTagsVerified
    && typeof tagsValue.industry_history === 'string'
    && tagsValue.industry_history.trim()
  ) {
    tags.push('former_power_ministry');
  }
  const nature = row.nature ?? (typeof row.metadata.school_nature === 'string' ? row.metadata.school_nature : null);
  const natureStatus = typeof row.metadata.nature_status === 'string'
    ? row.metadata.nature_status
    : 'pending';
  const natureBasis = typeof row.metadata.nature_basis === 'string'
    ? row.metadata.nature_basis
    : null;
  const natureSourceBacked = natureStatus === 'verified'
    || natureStatus === 'derived_from_official_note_convention';
  if (nature === '公办' && natureSourceBacked) tags.push('public_institution');
  // A verified school row does not prove its classification tags.  Automatic
  // eligibility reuse is authorized only after tag-level verification; the
  // public-school tag additionally requires a source-backed nature status.
  const tagSourceStatus = tierTagsVerified ? 'verified' : 'pending';
  const sourceKeys = unique(
    [
      ...(Array.isArray(row.metadata.source_ids) ? row.metadata.source_ids : []),
      ...(Array.isArray(tagsValue.source_ids) ? tagsValue.source_ids : []),
      ...(Array.isArray(row.metadata.nature_source_ids) ? row.metadata.nature_source_ids : []),
    ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
  );
  return {
    schoolKey: row.schoolKey,
    name: row.name,
    provinceAdcode: row.provinceAdcode,
    educationLevel: row.educationLevel,
    nature,
    natureStatus,
    natureBasis,
    schoolTags: unique(tags),
    tagSourceStatus,
    requiresConfirmation: tagSourceStatus !== 'verified',
    sourceKeys,
  };
}

export function sourceLocators(sourceRange: string): Record<string, string> {
  const match = /^Sheet1!A(\d+):K\1$/.exec(sourceRange);
  if (!match) return { range: sourceRange };
  const row = match[1]!;
  return {
    range: sourceRange,
    target: `Sheet1!A${row}`,
    year: `Sheet1!B${row}`,
    requirements: `Sheet1!C${row}`,
    process: `Sheet1!D${row}`,
    plannedHeadcount: `Sheet1!E${row}`,
    assessment: `Sheet1!F${row}`,
    itinerary: `Sheet1!G${row}`,
    siteQuota: `Sheet1!H${row}`,
    admissionRule: `Sheet1!I${row}`,
    actualHeadcount: `Sheet1!J${row}`,
    notes: `Sheet1!K${row}`,
  };
}

function applicantValue(applicant: EarlyBatchApplicant, field: string): unknown {
  if (field === 'languageQualification') {
    return applicant.degree === 'bachelor'
      ? applicant.cet4OrHigher
      : applicant.degree === 'master' || applicant.degree === 'doctor'
        ? applicant.cet6OrHigher
        : undefined;
  }
  if (field === 'schoolIdentity') {
    // An omitted school is unknown, not an explicit declaration that no school
    // category matches. Preserve explicit empty tags from confirmed input.
    if (!applicant.schoolName && applicant.schoolTags === undefined) return undefined;
    return unique([...(applicant.schoolTags ?? []), ...(applicant.schoolName ? [applicant.schoolName] : [])]);
  }
  return (applicant as Record<string, unknown>)[field];
}

function predicateResult(
  predicate: EarlyBatchPredicate,
  applicant: EarlyBatchApplicant,
): PredicateResult {
  const requirement: EarlyBatchRequirement = {
    field: predicate.field,
    label: predicate.label,
    operator: predicate.operator,
    expected: predicate.value,
  };
  const actual = applicantValue(applicant, predicate.field);

  if (predicate.operator === 'requires_manual_review') {
    const configuration = isRecord(predicate.value) ? predicate.value : {};
    const sourceText = typeof configuration.sourceText === 'string'
      ? configuration.sourceText
      : '源表未量化条件';
    const reason = typeof configuration.reason === 'string'
      ? configuration.reason
      : '源表没有提供可自动判定的阈值。';
    const inputState = actual === true
      ? '本人自评为“满足”'
      : actual === false
        ? '本人自评为“可能不满足”'
        : '未填写本人成绩自评';
    return {
      state: 'manual',
      requirement,
      manualReason: `${predicate.label}：${inputState}；${sourceText}，${reason}`,
    };
  }

  if (actual === undefined || actual === null || actual === '') {
    return { state: 'missing', requirement };
  }

  const expectedList = Array.isArray(predicate.value) ? predicate.value : [predicate.value];
  switch (predicate.operator) {
    case 'in':
      return { state: expectedList.includes(actual) ? 'pass' : 'fail', requirement };
    case 'equals':
      return { state: Object.is(actual, predicate.value) ? 'pass' : 'fail', requirement };
    case 'contains_any': {
      if (!Array.isArray(actual)) return { state: 'fail', requirement };
      return {
        state: actual.some((item) => expectedList.includes(item)) ? 'pass' : 'fail',
        requirement,
      };
    }
    case 'matches_any': {
      const actualList = Array.isArray(actual) ? actual : [actual];
      return {
        state: actualList.some((item) => expectedList.includes(item)) ? 'pass' : 'fail',
        requirement,
      };
    }
    case 'meets_degree_rule':
      return {
        state: actual === true && predicate.value === true ? 'pass' : 'fail',
        requirement,
      };
    case 'lte':
      return {
        state:
          typeof actual === 'number' &&
          typeof predicate.value === 'number' &&
          Number.isFinite(actual) &&
          actual <= predicate.value
            ? 'pass'
            : 'fail',
        requirement,
      };
    default:
      return { state: 'manual', requirement };
  }
}

export function eligibilityModel(policy: EarlyBatchPolicyRecord): EarlyBatchEligibilityModel {
  const model = policy.eligibilityModel;
  const branches = Array.isArray(model.branches)
    ? model.branches.filter(isRecord).map((branch) => ({
        key: String(branch.key ?? ''),
        outcome: branch.outcome === 'eligible_reference' ? 'eligible_reference' as const : 'manual_review' as const,
        reason: String(branch.reason ?? '该路径需要人工核验。'),
        predicates: Array.isArray(branch.predicates)
          ? branch.predicates.filter(isRecord).map((predicate) => ({
              field: String(predicate.field ?? ''),
              operator: String(predicate.operator ?? ''),
              value: predicate.value,
              label: String(predicate.label ?? predicate.field ?? '条件'),
            }))
          : [],
        notes: Array.isArray(branch.notes)
          ? branch.notes.filter((note): note is string => typeof note === 'string')
          : [],
      }))
    : [];
  return {
    version: typeof model.version === 'number' ? model.version : 1,
    confidence: typeof model.confidence === 'string' ? model.confidence : 'manual_review',
    branches,
    notes: Array.isArray(model.notes)
      ? model.notes.filter((note): note is string => typeof note === 'string')
      : [],
  };
}

export function evaluateEarlyBatchPolicy(
  policy: EarlyBatchPolicyRecord,
  applicant: EarlyBatchApplicant,
): EarlyBatchPolicyDecision {
  const model = eligibilityModel(policy);
  if (!model.branches.length) {
    return {
      decision: 'manual_review',
      basis: 'uploaded_workbook_rule',
      reason: '该目标尚未形成可执行的结构化规则，需要人工核验。',
      matchedBranchKey: null,
      missingInputs: [],
      unmetRequirements: [],
      manualReviewReasons: ['规则模型为空或无法解析。'],
      contextNotes: model.notes ?? [],
    };
  }

  const evaluated = model.branches.map((branch) => {
    const predicates = branch.predicates.map((predicate) => predicateResult(predicate, applicant));
    const state = predicates.some((item) => item.state === 'fail')
      ? 'fail'
      : predicates.some((item) => item.state === 'manual')
        ? 'manual'
        : predicates.some((item) => item.state === 'missing')
          ? 'missing'
          : 'pass';
    return { branch, predicates, state };
  });

  const eligible = evaluated.find(
    (item) => item.state === 'pass' && item.branch.outcome === 'eligible_reference',
  );
  if (eligible) {
    return {
      decision: 'eligible_under_workbook_rule',
      basis: 'uploaded_workbook_rule',
      reason: eligible.branch.reason,
      matchedBranchKey: eligible.branch.key,
      missingInputs: [],
      unmetRequirements: [],
      manualReviewReasons: [],
      contextNotes: model.notes ?? [],
    };
  }

  const manual = evaluated.find(
    (item) =>
      item.state === 'manual' ||
      (item.state === 'pass' && item.branch.outcome === 'manual_review'),
  );
  if (manual) {
    return {
      decision: 'manual_review',
      basis: 'uploaded_workbook_rule',
      reason: manual.branch.reason,
      matchedBranchKey: manual.state === 'pass' ? manual.branch.key : null,
      missingInputs: uniqueRequirements(
        manual.predicates
          .filter((item) => item.state === 'missing')
          .map((item) => item.requirement),
      ),
      unmetRequirements: [],
      manualReviewReasons: unique([
        manual.branch.reason,
        ...manual.predicates
          .filter((item) => item.state === 'manual')
          .map((item) => item.manualReason
            ?? `${item.requirement.label}使用了暂不支持的规则操作符。`),
        ...(manual.branch.notes ?? []),
      ]),
      contextNotes: model.notes ?? [],
    };
  }

  const potentiallyMatching = evaluated.filter((item) => item.state === 'missing');
  if (potentiallyMatching.length) {
    return {
      decision: 'missing_input',
      basis: 'uploaded_workbook_rule',
      reason: '缺少完成该目标资格判断所需的信息。',
      matchedBranchKey: null,
      missingInputs: uniqueRequirements(
        potentiallyMatching.flatMap((item) =>
          item.predicates
            .filter((predicate) => predicate.state === 'missing')
            .map((predicate) => predicate.requirement),
        ),
      ),
      unmetRequirements: [],
      manualReviewReasons: [],
      contextNotes: model.notes ?? [],
    };
  }

  return {
    decision: 'ineligible_under_workbook_rule',
    basis: 'uploaded_workbook_rule',
    reason: '当前输入不满足上传表格中已列出的正向资格路径。',
    matchedBranchKey: null,
    missingInputs: [],
    unmetRequirements: uniqueRequirements(
      evaluated.flatMap((item) =>
        item.predicates
          .filter((predicate) => predicate.state === 'fail')
          .map((predicate) => predicate.requirement),
      ),
    ),
    manualReviewReasons: [],
    contextNotes: model.notes ?? [],
  };
}

function uniqueRequirements(items: EarlyBatchRequirement[]): EarlyBatchRequirement[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.field}:${item.operator}:${JSON.stringify(item.expected)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
