import { z } from "zod";

import type { FormDefinition, FormField } from "../services/forms";

const formValueSchema = z.union([z.string(), z.boolean()]);
const formValuesSchema = z.record(z.string(), formValueSchema);

export type DynamicFormValues = z.infer<typeof formValuesSchema>;

function hasValue(value: string | boolean | undefined): boolean {
  return typeof value === "boolean" ? value : (value?.trim().length ?? 0) > 0;
}

function addFieldIssue(
  context: z.core.$RefinementCtx<DynamicFormValues>,
  fieldKey: string,
  message: string
): void {
  context.addIssue({ code: "custom", path: [fieldKey], message });
}

function countDecimalPlaces(value: string): number | null {
  const match = /^[-+]?(?:\d+)(?:\.(\d*))?(?:e([-+]?\d+))?$/i.exec(
    value.trim()
  );
  if (!match) {
    return null;
  }

  const fractionLength = match[1]?.length ?? 0;
  const exponent = Number(match[2] ?? 0);
  return Math.max(0, fractionLength - exponent);
}

function isValidDate(value: string): boolean {
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

function validateNumber(
  field: FormField,
  value: string,
  context: z.core.$RefinementCtx<DynamicFormValues>
): void {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    addFieldIssue(
      context,
      field.fieldKey,
      `${field.label} must be a finite number.`
    );
    return;
  }

  if (
    field.constraints.minValue !== null &&
    numberValue < field.constraints.minValue
  ) {
    addFieldIssue(
      context,
      field.fieldKey,
      `${field.label} must be ${field.constraints.minValue} or greater.`
    );
  }

  if (
    field.constraints.maxValue !== null &&
    numberValue > field.constraints.maxValue
  ) {
    addFieldIssue(
      context,
      field.fieldKey,
      `${field.label} must be ${field.constraints.maxValue} or less.`
    );
  }

  if (field.constraints.decimalPlaces !== null) {
    const decimalPlaces = countDecimalPlaces(value);
    if (
      decimalPlaces === null ||
      decimalPlaces > field.constraints.decimalPlaces
    ) {
      addFieldIssue(
        context,
        field.fieldKey,
        `${field.label} must use no more than ${field.constraints.decimalPlaces} decimal places.`
      );
    }
  }
}

function validateField(
  field: FormField,
  value: string | boolean | undefined,
  context: z.core.$RefinementCtx<DynamicFormValues>
): void {
  if (field.required && !hasValue(value)) {
    addFieldIssue(context, field.fieldKey, `${field.label} is required.`);
    return;
  }

  if (!hasValue(value)) {
    return;
  }

  if (field.inputType === "CHECKBOX") {
    if (typeof value !== "boolean") {
      addFieldIssue(context, field.fieldKey, `${field.label} must be checked or unchecked.`);
    }
    return;
  }

  if (typeof value !== "string") {
    addFieldIssue(context, field.fieldKey, `${field.label} has an invalid value.`);
    return;
  }

  if (field.inputType === "NUMBER") {
    validateNumber(field, value, context);
  }

  if (
    field.inputType === "SELECT" &&
    !field.options.some((option) => option.value === value)
  ) {
    addFieldIssue(
      context,
      field.fieldKey,
      `${field.label} must be one of the available options.`
    );
  }

  if (field.inputType === "DATE" && !isValidDate(value)) {
    addFieldIssue(context, field.fieldKey, `${field.label} must be a valid date.`);
  }

  if (
    field.inputType === "TIME" &&
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
  ) {
    addFieldIssue(context, field.fieldKey, `${field.label} must be a valid time.`);
  }

  if (
    field.constraints.maxLength !== null &&
    value.length > field.constraints.maxLength
  ) {
    addFieldIssue(
      context,
      field.fieldKey,
      `${field.label} must be ${field.constraints.maxLength} characters or fewer.`
    );
  }
}

export function createDynamicFormSchema(
  definition: Pick<FormDefinition, "fields" | "rules">
) {
  const fieldsByKey = new Map(
    definition.fields.map((field) => [field.fieldKey, field])
  );

  return formValuesSchema.superRefine((values, context) => {
    for (const field of definition.fields) {
      validateField(field, values[field.fieldKey], context);
    }

    for (const rule of definition.rules) {
      const populatedFieldKeys = rule.fieldKeys.filter((fieldKey) =>
        hasValue(values[fieldKey])
      );
      if (
        populatedFieldKeys.length === 0 ||
        populatedFieldKeys.length === rule.fieldKeys.length
      ) {
        continue;
      }

      for (const fieldKey of rule.fieldKeys) {
        if (hasValue(values[fieldKey])) {
          continue;
        }
        const field = fieldsByKey.get(fieldKey);
        const populatedField = fieldsByKey.get(populatedFieldKeys[0]);
        addFieldIssue(
          context,
          fieldKey,
          `${field?.label ?? fieldKey} is required when ${populatedField?.label ?? populatedFieldKeys[0]} is provided.`
        );
      }
    }
  });
}

export function createDynamicFormDefaultValues(
  fields: FormField[]
): DynamicFormValues {
  return Object.fromEntries(
    fields.map((field) => [
      field.fieldKey,
      field.inputType === "CHECKBOX" ? false : ""
    ])
  );
}
