export type EntityId = string | number;

export interface AdminIdentity {
  id: EntityId;
  username: string;
  displayName?: string;
}

export interface AuthPayload {
  admin: AdminIdentity;
  csrfToken: string;
  expiresAt?: string;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface PageResult<T extends Record<string, unknown> = Record<string, unknown>> {
  items: T[];
  meta: PageMeta;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: Partial<PageMeta>;
  csrfToken?: string;
  error?: string | { message?: string; code?: string };
  message?: string;
}

export type FieldKind =
  | "text"
  | "textarea"
  | "json"
  | "number"
  | "date"
  | "datetime-local"
  | "url"
  | "select"
  | "boolean";

export interface FieldOption {
  label: string;
  value: string | number | boolean;
  parentValue?: string;
}

export interface FieldDefinition {
  key: string;
  label: string;
  kind?: FieldKind;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: FieldOption[];
  min?: number;
  step?: number;
  rows?: number;
  readonly?: boolean;
  width?: "short" | "normal" | "wide";
  table?: boolean;
  format?: "datetime" | "date" | "boolean" | "status" | "url" | "number" | "auditAction" | "eventSemantic" | "eventTimeline" | "eventType" | "requirementTags";
  derive?: "sourceEvidenceTier" | "sourcePrivacyBoundary";
  emptyLabel?: string;
}

export interface FilterDefinition {
  key: string;
  label: string;
  kind?: "text" | "number" | "select";
  placeholder?: string;
  options?: FieldOption[];
  optionsEndpoint?: string;
  optionLabelKey?: string;
  optionValueKey?: string;
  optionParentKey?: string;
  dependsOn?: string;
  emptyOptionLabel?: string;
}

export interface ResourceDefinition {
  key: string;
  endpoint: string;
  title: string;
  singular: string;
  description: string;
  icon: string;
  fields: FieldDefinition[];
  readonly?: boolean;
  defaultSort?: string;
  entryNote?: string;
  filters?: FilterDefinition[];
  groupBy?: string[];
  groupSeparator?: string;
  hierarchySteps?: string[];
  countNoun?: string;
  defaultPageSize?: number;
}

export interface ToastMessage {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}
