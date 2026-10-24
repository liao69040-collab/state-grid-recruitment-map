import type { ProvincialRecruitmentRequirement } from '@/services/provincial-recruitment';

export const requirementTopics = [
  { key: 'education', label: '学历与院校' },
  { key: 'major', label: '专业要求' },
  { key: 'certificate', label: '证书要求' },
  { key: 'eligibility', label: '年龄与报考条件' },
  { key: 'other', label: '其他条件' },
] as const;

export function requirementTopic(item: ProvincialRecruitmentRequirement): typeof requirementTopics[number]['key'] {
  const text = `${item.category || ''} ${item.title || ''}`;
  if (/education|degree|school|学历|学位|院校|学校|毕业/.test(text)) return 'education';
  if (/major|discipline|专业/.test(text)) return 'major';
  if (/certificate|language|english|computer|证书|英语|计算机|等级/.test(text)) return 'certificate';
  if (/age|health|origin|application|qualification|年龄|健康|生源|资格|报名/.test(text)) return 'eligibility';
  return 'other';
}

/** Group for reading only; never rewrite, shorten, or infer an eligibility clause. */
export function groupProvinceRequirements(items: ProvincialRecruitmentRequirement[]) {
  return requirementTopics.map(topic => ({ ...topic, items: items.filter(item => requirementTopic(item) === topic.key) }))
    .filter(group => group.items.length);
}

/** Keep the material's confidence visible without internal A/B/C terminology. */
export function recruitmentReadingLabel(value: unknown): string {
  const tier = String(value ?? '').trim().toUpperCase();
  if (tier === 'A' || /^A[_-]/.test(tier)) return '当届公告';
  if (tier === 'B' || /^B[_-]/.test(tier)) return '往届参考';
  return '报考参考';
}

export function requirementParagraphs(text: string): string[] {
  return text.split(/\r?\n+/).map(line => line.trim()).filter(Boolean);
}
