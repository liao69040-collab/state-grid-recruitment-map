import type { FieldDefinition } from "../types";

/** PATCH only fields actually returned by the API; projections are not null values. */
export const editableFields = (fields: FieldDefinition[], item?: Record<string, unknown> | null) =>
  fields.filter(field => !field.readonly && (!item || (Object.hasOwn(item, field.key) && item[field.key] !== undefined)));

/** Unchanged null booleans must not become false through checkbox initialisation. */
export const fieldWasChanged = (current: unknown, initial: unknown) => !Object.is(current, initial);
