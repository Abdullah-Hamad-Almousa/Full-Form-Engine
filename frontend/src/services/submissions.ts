import { z } from "zod";

import type { DynamicFormValues } from "../validation/dynamic-form";
import { api } from "./api";
import type { FormDefinition, FormField } from "./forms";

const submissionSuccessEnvelopeSchema = z
  .object({
    data: z
      .object({
        id: z.string().trim().min(1)
      })
      .strict()
  })
  .strict();

export type SubmissionResponseValue = string | number | boolean;

export type CreateSubmissionRequest = {
  formVersionId: string;
  confirmed: true;
  responseData: Record<string, SubmissionResponseValue>;
};

export type CreatedSubmission = {
  id: string;
};

function invalidMappedValue(field: FormField): Error {
  return new Error(`Unable to map the configured ${field.fieldKey} value.`);
}

function mapConfiguredValue(
  field: FormField,
  value: string | boolean | undefined
): SubmissionResponseValue | undefined {
  if (field.inputType === "CHECKBOX") {
    if (value === undefined && !field.required) {
      return undefined;
    }
    if (typeof value !== "boolean" || (field.required && !value)) {
      throw invalidMappedValue(field);
    }
    return value;
  }

  if (typeof value !== "string") {
    throw invalidMappedValue(field);
  }

  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    if (field.required) {
      throw invalidMappedValue(field);
    }
    return undefined;
  }

  if (field.inputType === "NUMBER") {
    const numericValue = Number(normalizedValue);
    if (!Number.isFinite(numericValue)) {
      throw invalidMappedValue(field);
    }
    return numericValue;
  }

  return normalizedValue;
}

export function createSubmissionRequest(
  definition: FormDefinition,
  values: DynamicFormValues
): CreateSubmissionRequest {
  const responseData: Record<string, SubmissionResponseValue> = {};

  for (const field of definition.fields) {
    const mappedValue = mapConfiguredValue(field, values[field.fieldKey]);
    if (mappedValue !== undefined) {
      responseData[field.fieldKey] = mappedValue;
    }
  }

  return {
    formVersionId: definition.formVersionId,
    confirmed: true,
    responseData
  };
}

export async function createSubmission(
  fieldSlug: string,
  definition: FormDefinition,
  values: DynamicFormValues
): Promise<CreatedSubmission> {
  const response = await api<unknown>(
    `/api/fields/${encodeURIComponent(fieldSlug)}/submissions`,
    {
      method: "POST",
      body: JSON.stringify(createSubmissionRequest(definition, values)),
      expectedStatus: 201
    }
  );

  return submissionSuccessEnvelopeSchema.parse(response).data;
}
