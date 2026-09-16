import { InputType } from "@prisma/client";
import { z } from "zod";

import { ApplicationError } from "../middleware/error-handler.js";
import type {
  PublicFormConfiguration,
  PublicFormField
} from "../services/form-configuration.service.js";

const CONFIRMATION_MESSAGE =
  "Review the form and confirm that the entered values are correct.";
const VALIDATION_MESSAGE = "Check the highlighted values and try again.";

const submissionEnvelopeSchema = z
  .object({
    formVersionId: z
      .string({ error: "Select the current published form and try again." })
      .trim()
      .min(1, "Select the current published form and try again."),
    confirmed: z.literal(true, { error: CONFIRMATION_MESSAGE }),
    responseData: z.record(z.string(), z.unknown(), {
      error: "Provide the form response as a flat object."
    })
  })
  .strict();

export type SubmissionEnvelope = z.infer<typeof submissionEnvelopeSchema>;
export type CanonicalResponseValue = string | number | boolean;
export type CanonicalResponseData = Record<string, CanonicalResponseValue>;

export type ValidatedSubmissionResponse = {
  responseData: CanonicalResponseData;
  workDate: Date;
};

export class SubmissionConfigurationInvariantError extends Error {
  constructor() {
    super("Submission form configuration invariant failed.");
    this.name = "SubmissionConfigurationInvariantError";
  }
}

function addFirstFieldError(
  fields: Record<string, string>,
  fieldKey: string,
  message: string
): void {
  if (Object.prototype.hasOwnProperty.call(fields, fieldKey)) {
    return;
  }

  Object.defineProperty(fields, fieldKey, {
    value: message,
    enumerable: true,
    configurable: true,
    writable: true
  });
}

function mapEnvelopeIssues(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        addFirstFieldError(fields, key, "This request field is not allowed.");
      }
      continue;
    }

    const pathPart = issue.path[0];
    const fieldKey = typeof pathPart === "string" ? pathPart : "request";
    addFirstFieldError(fields, fieldKey, issue.message);
  }

  return fields;
}

export function parseSubmissionEnvelope(input: unknown): SubmissionEnvelope {
  const result = submissionEnvelopeSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  if (result.error.issues.some((issue) => issue.path[0] === "confirmed")) {
    throw new ApplicationError({
      status: 422,
      code: "CONFIRMATION_REQUIRED",
      message: CONFIRMATION_MESSAGE,
      fields: { confirmed: CONFIRMATION_MESSAGE }
    });
  }

  throw new ApplicationError({
    status: 422,
    code: "VALIDATION_FAILED",
    message: VALIDATION_MESSAGE,
    fields: mapEnvelopeIssues(result.error)
  });
}

function hasOwnField(
  responseData: Record<string, unknown>,
  fieldKey: string
): boolean {
  return Object.prototype.hasOwnProperty.call(responseData, fieldKey);
}

function isOmittableBlankTextArea(
  field: PublicFormField,
  value: unknown
): boolean {
  return (
    !field.required &&
    field.inputType === InputType.TEXTAREA &&
    typeof value === "string" &&
    value.trim().length === 0
  );
}

function parseDateOnlyUtc(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function countDecimalPlaces(value: number): number {
  const [coefficient, exponentText] = value.toString().toLowerCase().split("e");
  const fractionLength = coefficient?.split(".")[1]?.length ?? 0;
  const exponent = Number(exponentText ?? 0);
  return Math.max(0, fractionLength - exponent);
}

function validateNumber(
  field: PublicFormField,
  value: unknown,
  errors: Record<string, string>
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addFirstFieldError(
      errors,
      field.fieldKey,
      `${field.label} must be a finite number.`
    );
    return false;
  }

  if (
    field.constraints.minValue !== null &&
    value < field.constraints.minValue
  ) {
    addFirstFieldError(
      errors,
      field.fieldKey,
      `${field.label} must be ${field.constraints.minValue} or greater.`
    );
  }
  if (
    field.constraints.maxValue !== null &&
    value > field.constraints.maxValue
  ) {
    addFirstFieldError(
      errors,
      field.fieldKey,
      `${field.label} must be ${field.constraints.maxValue} or less.`
    );
  }
  if (
    field.constraints.decimalPlaces !== null &&
    countDecimalPlaces(value) > field.constraints.decimalPlaces
  ) {
    addFirstFieldError(
      errors,
      field.fieldKey,
      `${field.label} must use no more than ${field.constraints.decimalPlaces} decimal places.`
    );
  }

  return !Object.prototype.hasOwnProperty.call(errors, field.fieldKey);
}

function validateString(
  field: PublicFormField,
  value: unknown,
  errors: Record<string, string>
): value is string {
  if (typeof value !== "string") {
    addFirstFieldError(
      errors,
      field.fieldKey,
      `${field.label} has an invalid value.`
    );
    return false;
  }

  if (
    field.constraints.maxLength !== null &&
    value.length > field.constraints.maxLength
  ) {
    addFirstFieldError(
      errors,
      field.fieldKey,
      `${field.label} must be ${field.constraints.maxLength} characters or fewer.`
    );
  }

  return !Object.prototype.hasOwnProperty.call(errors, field.fieldKey);
}

function validateTextArea(
  field: PublicFormField,
  value: unknown,
  errors: Record<string, string>
): string | undefined {
  if (typeof value !== "string") {
    addFirstFieldError(
      errors,
      field.fieldKey,
      `${field.label} has an invalid value.`
    );
    return undefined;
  }

  const normalized = value.trim();
  if (
    field.constraints.maxLength !== null &&
    normalized.length > field.constraints.maxLength
  ) {
    addFirstFieldError(
      errors,
      field.fieldKey,
      `${field.label} must be ${field.constraints.maxLength} characters or fewer.`
    );
    return undefined;
  }

  return normalized;
}

function validateFieldValue(
  field: PublicFormField,
  value: unknown,
  errors: Record<string, string>
): CanonicalResponseValue | undefined {
  switch (field.inputType) {
    case InputType.NUMBER:
      return validateNumber(field, value, errors) ? value : undefined;

    case InputType.CHECKBOX:
      if (typeof value !== "boolean") {
        addFirstFieldError(
          errors,
          field.fieldKey,
          `${field.label} must be checked or unchecked.`
        );
        return undefined;
      }
      if (field.required && !value) {
        addFirstFieldError(
          errors,
          field.fieldKey,
          `${field.label} must be checked.`
        );
        return undefined;
      }
      return value;

    case InputType.DATE: {
      if (!validateString(field, value, errors)) {
        return undefined;
      }
      if (!parseDateOnlyUtc(value)) {
        addFirstFieldError(
          errors,
          field.fieldKey,
          `${field.label} must be a valid date.`
        );
        return undefined;
      }
      return value;
    }

    case InputType.TIME:
      if (!validateString(field, value, errors)) {
        return undefined;
      }
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        addFirstFieldError(
          errors,
          field.fieldKey,
          `${field.label} must be a valid time.`
        );
        return undefined;
      }
      return value;

    case InputType.SELECT:
      if (!validateString(field, value, errors)) {
        return undefined;
      }
      if (!field.options.some((option) => option.value === value)) {
        addFirstFieldError(
          errors,
          field.fieldKey,
          `${field.label} must be one of the available options.`
        );
        return undefined;
      }
      return value;

    case InputType.TEXTAREA:
      return validateTextArea(field, value, errors);
  }
}

function validatePairRules(
  configuration: PublicFormConfiguration,
  responseData: Record<string, unknown>,
  errors: Record<string, string>
): void {
  const fieldsByKey = new Map(
    configuration.fields.map((field) => [field.fieldKey, field])
  );

  for (const rule of configuration.rules) {
    const presentKeys = rule.fieldKeys.filter((fieldKey) => {
      if (!hasOwnField(responseData, fieldKey)) {
        return false;
      }

      const field = fieldsByKey.get(fieldKey);
      return (
        !field ||
        !isOmittableBlankTextArea(field, responseData[fieldKey])
      );
    });
    if (presentKeys.length === 0 || presentKeys.length === rule.fieldKeys.length) {
      continue;
    }

    const populatedField = fieldsByKey.get(presentKeys[0] ?? "");
    for (const fieldKey of rule.fieldKeys) {
      if (presentKeys.includes(fieldKey)) {
        continue;
      }
      const field = fieldsByKey.get(fieldKey);
      addFirstFieldError(
        errors,
        fieldKey,
        `${field?.label ?? fieldKey} is required when ${populatedField?.label ?? presentKeys[0]} is provided.`
      );
    }
  }
}

export function validateAndCanonicalizeResponseData(
  configuration: PublicFormConfiguration,
  responseData: Record<string, unknown>
): ValidatedSubmissionResponse {
  const fieldsByKey = new Map(
    configuration.fields.map((field) => [field.fieldKey, field])
  );
  const errors: Record<string, string> = {};
  const canonicalEntries: Array<[string, CanonicalResponseValue]> = [];

  for (const fieldKey of Object.keys(responseData)) {
    if (!fieldsByKey.has(fieldKey)) {
      addFirstFieldError(
        errors,
        fieldKey,
        "This field is not part of the current published form."
      );
    }
  }

  for (const field of configuration.fields) {
    if (!hasOwnField(responseData, field.fieldKey)) {
      if (field.required) {
        addFirstFieldError(
          errors,
          field.fieldKey,
          `${field.label} is required.`
        );
      }
      continue;
    }

    const rawValue = responseData[field.fieldKey];
    if (typeof rawValue === "string" && rawValue.trim().length === 0) {
      if (field.required) {
        addFirstFieldError(
          errors,
          field.fieldKey,
          `${field.label} is required.`
        );
        continue;
      }
      if (isOmittableBlankTextArea(field, rawValue)) {
        continue;
      }
    }

    const canonicalValue = validateFieldValue(
      field,
      rawValue,
      errors
    );
    if (canonicalValue !== undefined) {
      canonicalEntries.push([field.fieldKey, canonicalValue]);
    }
  }

  validatePairRules(configuration, responseData, errors);

  if (Object.keys(errors).length > 0) {
    throw new ApplicationError({
      status: 422,
      code: "VALIDATION_FAILED",
      message: VALIDATION_MESSAGE,
      fields: errors
    });
  }

  const canonicalResponseData = Object.fromEntries(canonicalEntries);
  const workDateValue = canonicalResponseData.workDate;
  const workDate =
    typeof workDateValue === "string" ? parseDateOnlyUtc(workDateValue) : null;
  if (!workDate) {
    throw new SubmissionConfigurationInvariantError();
  }

  return { responseData: canonicalResponseData, workDate };
}
