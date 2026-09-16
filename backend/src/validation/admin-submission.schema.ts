import { ApplicationError } from "../middleware/error-handler.js";

const VALIDATION_MESSAGE = "Check the highlighted values and try again.";
const CORRECTION_KEYS = new Set([
  "expectedUpdatedAt",
  "reason",
  "responseData"
]);
const STATE_CHANGE_KEYS = new Set(["expectedUpdatedAt", "reason"]);

export type AdminCorrectionBody = {
  expectedUpdatedAt: string;
  reason: string;
  responseData: Record<string, unknown>;
};

export type AdminStateChangeBody = {
  expectedUpdatedAt: string;
  reason: string;
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

function bodyRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw validationError({ request: "Provide a JSON request object." });
  }
  return input as Record<string, unknown>;
}

function rejectUnknownKeys(
  body: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  errors: Record<string, string>
): void {
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      addError(errors, key, "This request field is not allowed.");
    }
  }
}

function parseExpectedUpdatedAt(
  value: unknown,
  errors: Record<string, string>
): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    addError(
      errors,
      "expectedUpdatedAt",
      "Use the current submission update timestamp."
    );
    return "";
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    addError(
      errors,
      "expectedUpdatedAt",
      "Use the current submission update timestamp."
    );
    return "";
  }
  return value;
}

function parseReason(value: unknown, errors: Record<string, string>): string {
  if (typeof value !== "string") {
    addError(errors, "reason", "Provide a reason from 1 through 500 characters.");
    return "";
  }
  const reason = value.trim();
  if (reason.length < 1 || reason.length > 500 || reason.includes("\u0000")) {
    addError(errors, "reason", "Provide a reason from 1 through 500 characters.");
  }
  return reason;
}

function parseResponseData(
  value: unknown,
  errors: Record<string, string>
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    addError(errors, "responseData", "Provide the complete form response object.");
    return {};
  }
  return value as Record<string, unknown>;
}

export function parseAdminCorrectionBody(input: unknown): AdminCorrectionBody {
  const body = bodyRecord(input);
  const errors: Record<string, string> = {};
  rejectUnknownKeys(body, CORRECTION_KEYS, errors);
  const expectedUpdatedAt = parseExpectedUpdatedAt(
    body.expectedUpdatedAt,
    errors
  );
  const reason = parseReason(body.reason, errors);
  const responseData = parseResponseData(body.responseData, errors);
  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }
  return { expectedUpdatedAt, reason, responseData };
}

export function parseAdminStateChangeBody(
  input: unknown
): AdminStateChangeBody {
  const body = bodyRecord(input);
  const errors: Record<string, string> = {};
  rejectUnknownKeys(body, STATE_CHANGE_KEYS, errors);
  const expectedUpdatedAt = parseExpectedUpdatedAt(
    body.expectedUpdatedAt,
    errors
  );
  const reason = parseReason(body.reason, errors);
  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }
  return { expectedUpdatedAt, reason };
}
