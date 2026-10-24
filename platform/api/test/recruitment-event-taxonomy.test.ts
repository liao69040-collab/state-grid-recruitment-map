import { describe, expect, it } from 'vitest';
import {
  RECRUITMENT_EVENT_TYPE_LABELS,
  recruitmentEventTypeLabel,
} from '../src/lib/recruitment-event-taxonomy.js';

describe('recruitment event taxonomy', () => {
  it('maps every supported machine code to an operator-facing Chinese label', () => {
    for (const [code, label] of Object.entries(RECRUITMENT_EVENT_TYPE_LABELS)) {
      expect(recruitmentEventTypeLabel(code)).toBe(label);
      expect(label).not.toMatch(/[A-Za-z]/);
    }
  });

  it('does not leak unknown English codes into the operator UI', () => {
    expect(recruitmentEventTypeLabel('legacy_free_text_stage')).toBe('其他招聘节点（待归类）');
    expect(recruitmentEventTypeLabel(null)).toBe('其他招聘节点（待归类）');
  });
});
