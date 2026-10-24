import { z } from 'zod';
import { earlyBatchEligibilityModel } from '../resources.js';

export const earlyBatchSourceSchema = z
  .object({
    source_key: z.string().min(1).max(160),
    title: z.string().min(1),
    source_type: z.literal('uploaded_workbook'),
    publisher: z.string().nullable(),
    official_url: z.url().nullable(),
    archive_path: z.string().min(1),
    checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    cohort_year: z.literal(2026),
    batch_code: z.literal('campus'),
    unit_scope: z.string().min(1).max(200),
    status: z.literal('uploaded_reference_unverified'),
    notes: z.string().min(1),
    evidence_tier: z.literal('D'),
    public_use: z.literal('structured_policy_reference_only'),
    privacy_note: z.string().min(1),
    private_binary_not_shipped: z.literal(true),
  })
  .strict();

const earlyBatchRevisionSchema = z
  .object({
    revision_key: z.string().min(1).max(160),
    title: z.string().min(1).max(240),
    description: z.string().min(1),
    cohort_year: z.literal(2026),
    batch_code: z.literal('campus'),
    unit_scope: z.string().min(1).max(200),
    status: z.literal('published'),
    data_status: z.literal('uploaded_reference_unverified'),
  })
  .strict();

const earlyBatchPolicySchema = z
  .object({
    policy_key: z.string().min(1).max(200),
    cohort_year: z.literal(2026),
    batch_code: z.literal('campus'),
    target_kind: z.enum(['province', 'unit']),
    target_code: z.string().min(3).max(120).regex(/^[A-Z0-9-]+$/),
    target_name: z.string().min(1).max(120),
    province_adcode: z.string().regex(/^\d{6}$/).nullable(),
    parent_province_adcode: z.string().regex(/^\d{6}$/).nullable(),
    recruitment_requirements: z.string().min(1),
    recruitment_process: z.string().nullable(),
    planned_headcount_display: z.string().max(120).nullable(),
    assessment_method: z.string().nullable(),
    itinerary_reference: z.string().nullable(),
    site_quota_display: z.string().nullable(),
    admission_rule: z.string().nullable(),
    actual_headcount_display: z.string().max(120).nullable(),
    other_notes: z.string().nullable(),
    missing_fields: z.array(z.string().min(1)),
    eligibility_model: earlyBatchEligibilityModel,
    source_locator: z.string().regex(/^Sheet1!A\d+:K\d+$/),
    evidence_assets: z.array(z.record(z.string(), z.unknown())),
    external_evidence: z.array(z.record(z.string(), z.unknown())),
    source_status: z.literal('uploaded_reference_unverified'),
    publication_status: z.literal('published'),
    sort_order: z.number().int().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const earlyBatchSeedSchema = z
  .object({
    dataset_id: z.literal('early-batch-eligibility-2026-v1'),
    schema_version: z.literal('1.0.0'),
    generated_at: z.iso.datetime(),
    source_document: earlyBatchSourceSchema,
    revision: earlyBatchRevisionSchema,
    data_quality: z.record(z.string(), z.unknown()),
    policies: z.array(earlyBatchPolicySchema).length(24),
  })
  .strict();

export type EarlyBatchSeed = z.infer<typeof earlyBatchSeedSchema>;

export function earlyBatchSourceMetadata(seed: EarlyBatchSeed): Record<string, unknown> {
  return {
    dataset_id: seed.dataset_id,
    workbook_range: seed.data_quality.workbook_range,
    import_boundary: 'uploaded_workbook_not_official_source',
    evidence_tier: seed.source_document.evidence_tier,
    public_use: seed.source_document.public_use,
    privacy_note: seed.source_document.privacy_note,
    private_binary_not_shipped: seed.source_document.private_binary_not_shipped,
  };
}
