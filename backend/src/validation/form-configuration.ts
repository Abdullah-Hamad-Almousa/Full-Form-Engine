import { InputType } from "@prisma/client";

export type FormFieldConstraintDefinition = {
  minValue: number | null;
  maxValue: number | null;
  decimalPlaces: number | null;
  maxLength: number | null;
};

export type FormOptionDefinition = {
  value: string;
  label: string;
  displayOrder: number;
  active: boolean;
};

export type FormFieldDefinition = {
  fieldKey: string;
  label: string;
  inputType: InputType;
  required: boolean;
  unit: string | null;
  placeholder: string | null;
  constraints: FormFieldConstraintDefinition;
  displayOrder: number;
  showInTable: boolean;
  showInGraph: boolean;
  active: boolean;
  options: readonly FormOptionDefinition[];
};

export type AllOrNoneFormRule = {
  kind: "ALL_OR_NONE";
  fieldKeys: readonly string[];
};

export type RequiredPairFormRule = {
  kind: "REQUIRED_PAIR";
  fieldKeys: readonly string[];
};

export type FormPairRule = AllOrNoneFormRule | RequiredPairFormRule;

export type VersionedFormDefinition = {
  fieldSlug: string;
  versionNumber: number;
  fields: readonly FormFieldDefinition[];
  rules: readonly FormPairRule[];
};

const NO_CONSTRAINTS = {
  minValue: null,
  maxValue: null,
  decimalPlaces: null,
  maxLength: null
} as const satisfies FormFieldConstraintDefinition;

function option(
  value: string,
  label: string,
  displayOrder: number
): FormOptionDefinition {
  return { value, label, displayOrder, active: true };
}

function field(
  definition: Omit<
    FormFieldDefinition,
    "unit" | "placeholder" | "showInTable" | "showInGraph" | "active"
  >
): FormFieldDefinition {
  return {
    ...definition,
    unit: null,
    placeholder: null,
    showInTable: false,
    showInGraph: false,
    active: true
  };
}

export const MOST_DATA_FORM_V1 = {
  fieldSlug: "most-data",
  versionNumber: 1,
  fields: [
    field({
      fieldKey: "workDate",
      label: "Work date",
      inputType: InputType.DATE,
      required: true,
      constraints: NO_CONSTRAINTS,
      displayOrder: 10,
      options: []
    }),
    field({
      fieldKey: "workTime",
      label: "Work time",
      inputType: InputType.TIME,
      required: true,
      constraints: NO_CONSTRAINTS,
      displayOrder: 20,
      options: []
    }),
    field({
      fieldKey: "locationId",
      label: "Location",
      inputType: InputType.SELECT,
      required: true,
      constraints: NO_CONSTRAINTS,
      displayOrder: 30,
      options: [option("building-a", "Building A", 10)]
    }),
    field({
      fieldKey: "shiftId",
      label: "Shift",
      inputType: InputType.SELECT,
      required: true,
      constraints: NO_CONSTRAINTS,
      displayOrder: 40,
      options: [option("morning", "Morning", 10)]
    }),
    field({
      fieldKey: "heatValue",
      label: "Heat value",
      inputType: InputType.NUMBER,
      required: true,
      constraints: NO_CONSTRAINTS,
      displayOrder: 50,
      options: []
    }),
    field({
      fieldKey: "heatUnit",
      label: "Heat unit",
      inputType: InputType.SELECT,
      required: true,
      constraints: NO_CONSTRAINTS,
      displayOrder: 60,
      options: [
        option("CELSIUS", "°C - Celsius", 10),
        option("FAHRENHEIT", "°F - Fahrenheit", 20),
        option("KELVIN", "K - Kelvin", 30)
      ]
    }),
    field({
      fieldKey: "status",
      label: "Status",
      inputType: InputType.SELECT,
      required: true,
      constraints: NO_CONSTRAINTS,
      displayOrder: 70,
      options: [
        option("NORMAL", "Normal", 10),
        option("WARNING", "Warning", 20),
        option("PROBLEM", "Problem", 30),
        option("STOPPED", "Stopped", 40)
      ]
    }),
    field({
      fieldKey: "quantityValue",
      label: "Quantity or reading",
      inputType: InputType.NUMBER,
      required: false,
      constraints: NO_CONSTRAINTS,
      displayOrder: 80,
      options: []
    }),
    field({
      fieldKey: "quantityUnit",
      label: "Quantity unit",
      inputType: InputType.SELECT,
      required: false,
      constraints: NO_CONSTRAINTS,
      displayOrder: 90,
      options: [option("KG", "kg", 10)]
    }),
    field({
      fieldKey: "issueDetected",
      label: "Issue detected",
      inputType: InputType.CHECKBOX,
      required: false,
      constraints: NO_CONSTRAINTS,
      displayOrder: 100,
      options: []
    }),
    field({
      fieldKey: "notes",
      label: "Notes",
      inputType: InputType.TEXTAREA,
      required: false,
      constraints: {
        ...NO_CONSTRAINTS,
        maxLength: 2_000
      },
      displayOrder: 110,
      options: []
    })
  ],
  rules: [
    {
      kind: "REQUIRED_PAIR",
      fieldKeys: ["heatValue", "heatUnit"]
    },
    {
      kind: "ALL_OR_NONE",
      fieldKeys: ["quantityValue", "quantityUnit"]
    }
  ]
} as const satisfies VersionedFormDefinition;

const VERSIONED_FORM_DEFINITIONS: readonly VersionedFormDefinition[] = [
  MOST_DATA_FORM_V1
];

export function findVersionedFormDefinition(
  fieldSlug: string,
  versionNumber: number
): VersionedFormDefinition | null {
  return (
    VERSIONED_FORM_DEFINITIONS.find(
      (definition) =>
        definition.fieldSlug === fieldSlug &&
        definition.versionNumber === versionNumber
    ) ?? null
  );
}

export function getEffectiveMaxLength(
  fieldSlug: string,
  versionNumber: number,
  fieldKey: string
): number | null {
  const definition = findVersionedFormDefinition(fieldSlug, versionNumber);
  return (
    definition?.fields.find((candidate) => candidate.fieldKey === fieldKey)
      ?.constraints.maxLength ?? null
  );
}

export function getEffectiveFormRules(
  fieldSlug: string,
  versionNumber: number
): AllOrNoneFormRule[] {
  const definition = findVersionedFormDefinition(fieldSlug, versionNumber);
  return (definition?.rules ?? [])
    .filter((rule): rule is AllOrNoneFormRule => rule.kind === "ALL_OR_NONE")
    .map((rule) => ({
      kind: rule.kind,
      fieldKeys: [...rule.fieldKeys]
    }));
}

export function validateVersionedFormDefinition(
  definition: VersionedFormDefinition
): void {
  if (!Number.isInteger(definition.versionNumber) || definition.versionNumber < 1) {
    throw new Error("Form version number must be a positive integer.");
  }
  if (definition.fields.length === 0) {
    throw new Error("A form definition must contain at least one field.");
  }

  const fieldKeys = new Set<string>();
  const fieldOrders = new Set<number>();
  for (const configuredField of definition.fields) {
    if (fieldKeys.has(configuredField.fieldKey)) {
      throw new Error(`Duplicate form field key: ${configuredField.fieldKey}.`);
    }
    if (fieldOrders.has(configuredField.displayOrder)) {
      throw new Error(
        `Duplicate form field display order: ${configuredField.displayOrder}.`
      );
    }
    fieldKeys.add(configuredField.fieldKey);
    fieldOrders.add(configuredField.displayOrder);

    const { minValue, maxValue, decimalPlaces, maxLength } =
      configuredField.constraints;
    if (minValue !== null && maxValue !== null && minValue > maxValue) {
      throw new Error(`Invalid numeric range for ${configuredField.fieldKey}.`);
    }
    if (
      decimalPlaces !== null &&
      (!Number.isInteger(decimalPlaces) || decimalPlaces < 0)
    ) {
      throw new Error(`Invalid decimal precision for ${configuredField.fieldKey}.`);
    }
    if (maxLength !== null && (!Number.isInteger(maxLength) || maxLength < 1)) {
      throw new Error(`Invalid maximum length for ${configuredField.fieldKey}.`);
    }

    const optionValues = new Set<string>();
    const optionOrders = new Set<number>();
    for (const configuredOption of configuredField.options) {
      if (optionValues.has(configuredOption.value)) {
        throw new Error(
          `Duplicate option value for ${configuredField.fieldKey}: ${configuredOption.value}.`
        );
      }
      if (optionOrders.has(configuredOption.displayOrder)) {
        throw new Error(
          `Duplicate option display order for ${configuredField.fieldKey}: ${configuredOption.displayOrder}.`
        );
      }
      optionValues.add(configuredOption.value);
      optionOrders.add(configuredOption.displayOrder);
    }

    const supportsOptions =
      configuredField.inputType === InputType.SELECT ||
      configuredField.inputType === InputType.MULTI_SELECT;
    if (supportsOptions !== (configuredField.options.length > 0)) {
      throw new Error(
        `Option configuration does not match input type for ${configuredField.fieldKey}.`
      );
    }
  }

  for (const rule of definition.rules) {
    if (rule.fieldKeys.length < 2 || rule.fieldKeys.some((key) => !fieldKeys.has(key))) {
      throw new Error("Form rule references an invalid field set.");
    }
    if (
      rule.kind === "REQUIRED_PAIR" &&
      rule.fieldKeys.some(
        (key) =>
          !definition.fields.find((configuredField) => configuredField.fieldKey === key)
            ?.required
      )
    ) {
      throw new Error("A required pair rule references an optional field.");
    }
  }
}
