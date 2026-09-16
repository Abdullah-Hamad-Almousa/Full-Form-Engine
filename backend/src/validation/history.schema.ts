import { ApplicationError } from "../middleware/error-handler.js";

const VALIDATION_MESSAGE = "Check the requested filters and try again.";
const BASE_QUERY_KEYS = new Set(["page", "pageSize", "from", "to"]);
const MANAGER_QUERY_KEYS = new Set([...BASE_QUERY_KEYS, "workerId"]);
const ADMIN_QUERY_KEYS = new Set([
  ...BASE_QUERY_KEYS,
  "fieldSlug",
  "userId",
  "state"
]);
const AUDIT_QUERY_KEYS = new Set([
  "page",
  "pageSize",
  "entityType",
  "entityId"
]);

export type HistoryPaginationQuery = {
  page: number;
  pageSize: number;
  from: string | undefined;
  to: string | undefined;
};

export type SelfHistoryQuery = HistoryPaginationQuery;

export type ManagerHistoryQuery = HistoryPaginationQuery & {
  workerId: string | undefined;
};

export type AdminHistoryState = "ACTIVE" | "DELETED" | "ALL";

export type AdminHistoryQuery = HistoryPaginationQuery & {
  fieldSlug: string | undefined;
  userId: string | undefined;
  state: AdminHistoryState;
};

export type AuditLogQuery = {
  page: number;
  pageSize: number;
  entityType: string | undefined;
  entityId: string | undefined;
};

function validationError(fields: Record<string, string>): ApplicationError {
  return new ApplicationError({
    status: 422,
    code: "VALIDATION_FAILED",
    message: VALIDATION_MESSAGE,
    fields
  });
}

function addError(
  errors: Record<string, string>,
  field: string,
  message: string
): void {
  if (!Object.prototype.hasOwnProperty.call(errors, field)) {
    errors[field] = message;
  }
}

function queryRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw validationError({ request: "Provide filters as a query object." });
  }
  return input as Record<string, unknown>;
}

function rejectUnknownKeys(
  query: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  errors: Record<string, string>
): void {
  for (const key of Object.keys(query)) {
    if (!allowedKeys.has(key)) {
      addError(errors, key, "This query filter is not allowed.");
    }
  }
}

function parsePositiveInteger(
  value: unknown,
  field: string,
  defaultValue: number,
  maximum: number | null,
  errors: Record<string, string>
): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    addError(errors, field, `${field} must be a positive integer.`);
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (maximum !== null && parsed > maximum)) {
    addError(
      errors,
      field,
      maximum === null
        ? `${field} must be a positive integer.`
        : `${field} must be between 1 and ${maximum}.`
    );
    return defaultValue;
  }
  return parsed;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function parseDateFilter(
  value: unknown,
  field: "from" | "to",
  errors: Record<string, string>
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !isCalendarDate(value)) {
    addError(errors, field, `${field} must be a valid YYYY-MM-DD work date.`);
    return undefined;
  }
  return value;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function parseOpaqueValue(
  value: unknown,
  field: string,
  maximumLength: number,
  errors: Record<string, string>
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    hasControlCharacters(value)
  ) {
    addError(errors, field, `${field} has an invalid value.`);
    return undefined;
  }
  return value;
}

function parsePagination(
  query: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): { pagination: HistoryPaginationQuery; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  rejectUnknownKeys(query, allowedKeys, errors);
  const page = parsePositiveInteger(query.page, "page", 1, null, errors);
  const pageSize = parsePositiveInteger(
    query.pageSize,
    "pageSize",
    25,
    100,
    errors
  );
  const from = parseDateFilter(query.from, "from", errors);
  const to = parseDateFilter(query.to, "to", errors);
  if (from && to && from > to) {
    addError(errors, "to", "to must be on or after from.");
  }
  return { pagination: { page, pageSize, from, to }, errors };
}

export function parseSelfHistoryQuery(input: unknown): SelfHistoryQuery {
  const query = queryRecord(input);
  const { pagination, errors } = parsePagination(query, BASE_QUERY_KEYS);
  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }
  return pagination;
}

export function parseManagerHistoryQuery(input: unknown): ManagerHistoryQuery {
  const query = queryRecord(input);
  const { pagination, errors } = parsePagination(query, MANAGER_QUERY_KEYS);
  const workerId = parseOpaqueValue(query.workerId, "workerId", 200, errors);
  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }
  return { ...pagination, workerId };
}

export function parseAdminHistoryQuery(input: unknown): AdminHistoryQuery {
  const query = queryRecord(input);
  const { pagination, errors } = parsePagination(query, ADMIN_QUERY_KEYS);
  const fieldSlug = parseOpaqueValue(query.fieldSlug, "fieldSlug", 100, errors);
  if (fieldSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fieldSlug)) {
    addError(errors, "fieldSlug", "fieldSlug has an invalid value.");
  }
  const userId = parseOpaqueValue(query.userId, "userId", 200, errors);
  let state: AdminHistoryState = "ACTIVE";
  if (query.state !== undefined) {
    if (
      query.state === "ACTIVE" ||
      query.state === "DELETED" ||
      query.state === "ALL"
    ) {
      state = query.state;
    } else {
      addError(errors, "state", "state must be ACTIVE, DELETED, or ALL.");
    }
  }
  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }
  return { ...pagination, fieldSlug, userId, state };
}

export function parseAuditLogQuery(input: unknown): AuditLogQuery {
  const query = queryRecord(input);
  const errors: Record<string, string> = {};
  rejectUnknownKeys(query, AUDIT_QUERY_KEYS, errors);
  const page = parsePositiveInteger(query.page, "page", 1, null, errors);
  const pageSize = parsePositiveInteger(
    query.pageSize,
    "pageSize",
    25,
    100,
    errors
  );
  const entityType = parseOpaqueValue(
    query.entityType,
    "entityType",
    100,
    errors
  );
  if (entityType && !/^[A-Z][A-Z0-9_]*$/.test(entityType)) {
    addError(errors, "entityType", "entityType has an invalid value.");
  }
  const entityId = parseOpaqueValue(query.entityId, "entityId", 200, errors);
  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }
  return { page, pageSize, entityType, entityId };
}
