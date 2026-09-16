import { InputType, Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  FormConfigurationInvariantError,
  mapPublishedFormConfiguration
} from "./form-configuration.service.js";

type TestFieldOverrides = {
  fieldKey: string;
  displayOrder: number;
  inputType?: InputType;
  minValue?: Prisma.Decimal | null;
  maxValue?: Prisma.Decimal | null;
  decimalPlaces?: number | null;
  required?: boolean;
  active?: boolean;
  options?: Array<{
    value: string;
    label: string;
    displayOrder: number;
    active: boolean;
    internalOptionId?: string;
  }>;
};

function testField({
  fieldKey,
  displayOrder,
  inputType = InputType.TEXT,
  minValue = null,
  maxValue = null,
  decimalPlaces = null,
  required = false,
  active = true,
  options = []
}: TestFieldOverrides) {
  return {
    fieldKey,
    label: fieldKey,
    inputType,
    required,
    placeholder: null,
    minValue,
    maxValue,
    decimalPlaces,
    displayOrder,
    active,
    options
  };
}

describe("public form configuration mapping", () => {
  it("filters inactive configuration, orders deterministically, and serializes Decimals deliberately", () => {
    const source = {
      id: "opaque-version-id",
      versionNumber: 1,
      publishedAt: new Date("2026-08-25T04:00:00.000Z"),
      createdById: "internal-creator-id",
      fieldModuleId: "internal-field-module-id",
      fields: [
        testField({
          fieldKey: "quantityUnit",
          displayOrder: 90,
          inputType: InputType.SELECT,
          options: [
            {
              value: "ZZ",
              label: "Inactive",
              displayOrder: 5,
              active: false,
              internalOptionId: "hidden-option-id"
            },
            { value: "KG", label: "kg", displayOrder: 10, active: true }
          ]
        }),
        testField({
          fieldKey: "notes",
          displayOrder: 110,
          inputType: InputType.TEXTAREA
        }),
        testField({
          fieldKey: "heatValue",
          displayOrder: 50,
          inputType: InputType.NUMBER,
          required: true,
          minValue: new Prisma.Decimal("-12.5"),
          maxValue: new Prisma.Decimal("120.25"),
          decimalPlaces: 2
        }),
        testField({
          fieldKey: "heatUnit",
          displayOrder: 60,
          inputType: InputType.SELECT,
          required: true
        }),
        testField({
          fieldKey: "quantityValue",
          displayOrder: 80,
          inputType: InputType.NUMBER
        }),
        testField({
          fieldKey: "workTime",
          displayOrder: 20,
          inputType: InputType.TIME
        }),
        testField({
          fieldKey: "workDate",
          displayOrder: 20,
          inputType: InputType.DATE
        }),
        testField({ fieldKey: "inactiveField", displayOrder: 1, active: false })
      ]
    };

    const result = mapPublishedFormConfiguration("most-data", source);

    expect(result).toEqual({
      formVersionId: "opaque-version-id",
      versionNumber: 1,
      fields: [
        expect.objectContaining({ fieldKey: "workDate" }),
        expect.objectContaining({ fieldKey: "workTime" }),
        expect.objectContaining({
          fieldKey: "heatValue",
          constraints: {
            minValue: -12.5,
            maxValue: 120.25,
            decimalPlaces: 2,
            maxLength: null
          }
        }),
        expect.objectContaining({ fieldKey: "heatUnit" }),
        expect.objectContaining({ fieldKey: "quantityValue" }),
        expect.objectContaining({
          fieldKey: "quantityUnit",
          options: [{ value: "KG", label: "kg" }]
        }),
        expect.objectContaining({
          fieldKey: "notes",
          constraints: {
            minValue: null,
            maxValue: null,
            decimalPlaces: null,
            maxLength: 2_000
          }
        })
      ],
      rules: [
        {
          kind: "ALL_OR_NONE",
          fieldKeys: ["quantityValue", "quantityUnit"]
        }
      ]
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("internal-creator-id");
    expect(serialized).not.toContain("internal-field-module-id");
    expect(serialized).not.toContain("hidden-option-id");
    expect(serialized).not.toContain("inactiveField");
  });

  it("rejects a Decimal that cannot be represented exactly in the public number contract", () => {
    const source = {
      id: "opaque-version-id",
      versionNumber: 1,
      publishedAt: new Date(),
      fields: [
        testField({
          fieldKey: "heatValue",
          displayOrder: 1,
          inputType: InputType.NUMBER,
          required: true
        }),
        testField({
          fieldKey: "heatUnit",
          displayOrder: 2,
          inputType: InputType.SELECT,
          required: true
        }),
        testField({
          fieldKey: "quantityValue",
          displayOrder: 10,
          inputType: InputType.NUMBER,
          minValue: new Prisma.Decimal("0.123456789012345678901")
        }),
        testField({
          fieldKey: "quantityUnit",
          displayOrder: 20,
          inputType: InputType.SELECT
        })
      ]
    };

    expect(() => mapPublishedFormConfiguration("most-data", source)).toThrow(
      FormConfigurationInvariantError
    );
  });

  it("rejects published versions without supported version-aware rules", () => {
    const source = {
      id: "unsupported-version-id",
      versionNumber: 2,
      publishedAt: new Date(),
      fields: []
    };

    expect(() => mapPublishedFormConfiguration("most-data", source)).toThrow(
      FormConfigurationInvariantError
    );
  });

  it("rejects a rule that references an inactive configured field", () => {
    const source = {
      id: "opaque-version-id",
      versionNumber: 1,
      publishedAt: new Date(),
      fields: [
        testField({
          fieldKey: "heatValue",
          displayOrder: 1,
          inputType: InputType.NUMBER,
          required: true
        }),
        testField({
          fieldKey: "heatUnit",
          displayOrder: 2,
          inputType: InputType.SELECT,
          required: true
        }),
        testField({
          fieldKey: "quantityValue",
          displayOrder: 10,
          inputType: InputType.NUMBER
        }),
        testField({
          fieldKey: "quantityUnit",
          displayOrder: 20,
          inputType: InputType.SELECT,
          active: false
        })
      ]
    };

    expect(() => mapPublishedFormConfiguration("most-data", source)).toThrow(
      FormConfigurationInvariantError
    );
  });

  it("rejects a required Heat pair whose stored required state is inconsistent", () => {
    const source = {
      id: "opaque-version-id",
      versionNumber: 1,
      publishedAt: new Date(),
      fields: [
        testField({
          fieldKey: "heatValue",
          displayOrder: 1,
          inputType: InputType.NUMBER
        }),
        testField({
          fieldKey: "heatUnit",
          displayOrder: 2,
          inputType: InputType.SELECT,
          required: true
        }),
        testField({
          fieldKey: "quantityValue",
          displayOrder: 10,
          inputType: InputType.NUMBER
        }),
        testField({
          fieldKey: "quantityUnit",
          displayOrder: 20,
          inputType: InputType.SELECT
        })
      ]
    };

    expect(() => mapPublishedFormConfiguration("most-data", source)).toThrow(
      FormConfigurationInvariantError
    );
  });

  it("rejects an active field type outside the supported v1 public contract", () => {
    const source = {
      id: "opaque-version-id",
      versionNumber: 1,
      publishedAt: new Date(),
      fields: [
        testField({
          fieldKey: "workDate",
          displayOrder: 1,
          inputType: InputType.TEXT
        }),
        testField({
          fieldKey: "heatValue",
          displayOrder: 2,
          inputType: InputType.NUMBER,
          required: true
        }),
        testField({
          fieldKey: "heatUnit",
          displayOrder: 3,
          inputType: InputType.SELECT,
          required: true
        }),
        testField({
          fieldKey: "quantityValue",
          displayOrder: 4,
          inputType: InputType.NUMBER
        }),
        testField({
          fieldKey: "quantityUnit",
          displayOrder: 5,
          inputType: InputType.SELECT
        })
      ]
    };

    expect(() => mapPublishedFormConfiguration("most-data", source)).toThrow(
      FormConfigurationInvariantError
    );
  });
});
