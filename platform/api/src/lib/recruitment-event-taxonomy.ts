export const RECRUITMENT_EVENT_TYPE_LABELS = {
  campus_presentation: '招聘宣讲',
  campus_recruitment_period: '校园招聘期',
  recruitment_activity: '招聘活动',
  application_start: '网申开始',
  application: '网申/报名',
  application_deadline: '网申截止',
  application_end: '网申截止',
  qualification_review: '资格审查',
  qualification: '资格审查',
  onsite_qualification_review: '现场资格审查',
  exam_notification: '考试通知',
  exam_notice_confirmation: '考试通知确认',
  written_exam: '笔试',
  assessment: '考核/测评',
  physical_test: '体能测试',
  interview: '面试',
  medical_or_onboarding_check: '体检/入职审查',
  signing_or_confirmation: '签约/确认',
  public_notice: '公示',
  announcement: '公示',
  public_notice_end: '公示结束',
  onboarding: '入职报到',
  other_recruitment_event: '其他招聘节点',
  other: '其他招聘节点',
} as const;

export type RecruitmentEventType = keyof typeof RECRUITMENT_EVENT_TYPE_LABELS;

/**
 * The database keeps stable machine codes, while every operator-facing surface
 * must show Chinese. Unknown legacy codes are deliberately not echoed back.
 */
export function recruitmentEventTypeLabel(value: unknown): string {
  const key = String(value ?? '') as RecruitmentEventType;
  return RECRUITMENT_EVENT_TYPE_LABELS[key] ?? '其他招聘节点（待归类）';
}
