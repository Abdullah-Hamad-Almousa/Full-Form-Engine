import { FormStatus, InputType, Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import {
  findVersionedFormDefinition,
  getEffectiveFormRules,
  getEffectiveMaxLength,
  type AllOrNoneFormRule
} from "../validation/form-configuration.js";

export type PublicFormFieldConstraints = {
  minValue: number | null;
  maxValue: number | null;
  decimalPlaces: number | null;
  maxLength: number | null;
};

export type PublicFormOption = {
  value: string;
  label: string;
};

export type PublicFormInputType =
  | typeof InputType.DATE
  | typeof InputType.TIME
  | typeof InputType.SELECT
  | typeof InputType.NUMBER
  | typeof InputType.CHECKBOX
  | typeof InputType.TEXTAREA;

export type PublicFormField = {
  fieldKey: string;
  label: string;
  inputType: PublicFormInputType;
  required: boolean;
  placeholder: string | null;
  constraints: PublicFormFieldConstraints;
  options: PublicFormOption[];
};

export type PublicFormConfiguration = {
  formVersionId: string;
  versionNumber: number;
  fields: PublicFormField[];
  rules: AllOrNoneFormRule[];
};

export type StoredFormOption = {
  value: string;
  label: string;
  displayOrder: number;
  active: boolean;
};

export type StoredFormField = {
  fieldKey: string;
  label: string;
  inputType: InputType;
  required: boolean;
  placeholder: string | null;
  minValue: Prisma.Decimal | null;
  maxValue: Prisma.Decimal | null;
  decimalPlaces: number | null;
  displayOrder: number;
  active: boolean;
  options: readonly StoredFormOption[];
};

function isPublicFormInputType(
  inputType: InputType
): inputType is PublicFormInputType {
  return (
    inputType === InputType.DATE ||
    inputType === InputType.TIME ||
    inputType === InputType.SELECT ||
    inputType === InputType.NUMBER ||
    inputType === InputType.CHECKBOX ||
    inputType === InputType.TEXTAREA
  );
}

export type StoredPublishedFormConfiguration = {
  id: string;
  versionNumber: number;
  publishedAt: Date | null;
  fields: readonly StoredFormField[];
};

export const formConfigurationSelect = {
  id: true,
  versionNumber: true,
  publishedAt: true,
  fields: {
    where: { active: true },
    select: {
      fieldKey: true,
      label: true,
      inputType: true,
      required: true,
      placeholder: true,
      minValue: true,
      maxValue: true,
      decimalPlaces: true,
      displayOrder: true,
      active: true,
      options: {
        where: { active: true },
        select: {
          value: true,
          label: true,
          displayOrder: true,
          active: true
        },
        orderBy: [{ displayOrder: "asc" }, { value: "asc" }]
      }
    },
    orderBy: [{ displayOrder: "asc" }, { fieldKey: "asc" }]
  }
} satisfies Prisma.FormVersionSelect;

export class FormConfigurationInvariantError extends Error {
  constructor() {
    super("Published form configuration invariant failed.");
    this.name = "FormConfigurationInvariantError";
  }
}

function serializeDecimal(value: Prisma.Decimal | null): number | null {
  if (value === null) {
    return null;
  }

  const serialized = value.toNumber();
  if (
    !Number.isFinite(serialized) ||
    !new Prisma.Decimal(serialized).equals(value)
  ) {
    throw new FormConfigurationInvariantError();
  }
  return serialized;
}

function compareStoredFields(
  left: StoredFormField,
  right: StoredFormField
): number {
  return (
    left.displayOrder - right.displayOrder ||
    compareStableText(left.fieldKey, right.fieldKey)
  );
}

function compareStableText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareStoredOptions(
  left: StoredFormOption,
  right: StoredFormOption
): number {
  return (
    left.displayOrder - right.displayOrder ||
    compareStableText(left.value, right.value)
  );
}

export function mapPublishedFormConfiguration(
  fieldSlug: string,
  formVersion: StoredPublishedFormConfiguration
): PublicFormConfiguration {
  if (formVersion.publishedAt === null) {
    throw new FormConfigurationInvariantError();
  }
  const versionedDefinition = findVersionedFormDefinition(
    fieldSlug,
    formVersion.versionNumber
  );
  if (!versionedDefinition) {
    throw new FormConfigurationInvariantError();
  }

  const fields = formVersion.fields
    .filter((configuredField) => configuredField.active)
    .sort(compareStoredFields)
    .map((configuredField) => {
      const expectedField = versionedDefinition.fields.find(
        ({ fieldKey }) => fieldKey === configuredField.fieldKey
      );
      if (
        !expectedField ||
        expectedField.inputType !== configuredField.inputType ||
        !isPublicFormInputType(configuredField.inputType)
      ) {
        throw new FormConfigurationInvariantError();
      }

      return {
        fieldKey: configuredField.fieldKey,
        label: configuredField.label,
        inputType: configuredField.inputType,
        required: configuredField.required,
        placeholder: configuredField.placeholder,
        constraints: {
          minValue: serializeDecimal(configuredField.minValue),
          maxValue: serializeDecimal(configuredField.maxValue),
          decimalPlaces: configuredField.decimalPlaces,
          maxLength: getEffectiveMaxLength(
            fieldSlug,
            formVersion.versionNumber,
            configuredField.fieldKey
          )
        },
        options: configuredField.options
          .filter((configuredOption) => configuredOption.active)
          .sort(compareStoredOptions)
          .map(({ value, label }) => ({ value, label }))
      };
    });

  const rules = getEffectiveFormRules(fieldSlug, formVersion.versionNumber);
  const activeFieldsByKey = new Map(
    fields.map((configuredField) => [configuredField.fieldKey, configuredField])
  );
  if (
    versionedDefinition.rules.some((rule) =>
      rule.fieldKeys.some((fieldKey) => {
        const configuredField = activeFieldsByKey.get(fieldKey);
        return (
          !configuredField ||
          (rule.kind === "REQUIRED_PAIR" && !configuredField.required)
        );
      })
    )
  ) {
    throw new FormConfigurationInvariantError();
  }

  return {
    formVersionId: formVersion.id,
    versionNumber: formVersion.versionNumber,
    fields,
    rules
  };
}

export async function findPublishedFormConfiguration(
  fieldModuleId: string,
  fieldSlug: string
): Promise<PublicFormConfiguration | null> {
  const publishedForms = await prisma.formVersion.findMany({
    where: {
      fieldModuleId,
      status: FormStatus.PUBLISHED
    },
    select: formConfigurationSelect,
    orderBy: [{ versionNumber: "asc" }, { id: "asc" }],
    take: 2
  });

  if (publishedForms.length > 1) {
    throw new FormConfigurationInvariantError();
  }

  const [publishedForm] = publishedForms;
  return publishedForm
    ? mapPublishedFormConfiguration(fieldSlug, publishedForm)
    : null;
}
