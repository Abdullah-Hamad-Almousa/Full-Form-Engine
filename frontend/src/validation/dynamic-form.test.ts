import { describe, expect, it } from "vitest";

import { mostDataForm, validMostDataValues } from "../test/form-fixtures";
import { createDynamicFormSchema } from "./dynamic-form";

type ValidationResult = ReturnType<
  ReturnType<typeof createDynamicFormSchema>["safeParse"]
>;

function messagesFor(result: ValidationResult, fieldKey: string): string[] {
  if (result.success) {
    return [];
  }
  return result.error.issues
    .filter((issue) => issue.path[0] === fieldKey)
    .map((issue) => issue.message);
}

describe("dynamic form validation", () => {
  const schema = createDynamicFormSchema(mostDataForm);

  it.each(["", "   "])(
    "treats an empty numeric value %j as missing instead of zero",
    (heatValue) => {
      const result = schema.safeParse({ ...validMostDataValues, heatValue });

      expect(messagesFor(result, "heatValue")).toEqual([
        "Heat value is required."
      ]);
    }
  );

  it.each(["NaN", "Infinity", "-Infinity"])(
    "rejects the non-finite numeric value %s",
    (heatValue) => {
      const result = schema.safeParse({ ...validMostDataValues, heatValue });

      expect(messagesFor(result, "heatValue")).toContain(
        "Heat value must be a finite number."
      );
    }
  );

  it("rejects a selection that is not in the returned active options", () => {
    const result = schema.safeParse({
      ...validMostDataValues,
      heatUnit: "INACTIVE_UNIT"
    });

    expect(messagesFor(result, "heatUnit")).toContain(
      "Heat unit must be one of the available options."
    );
  });

  it("rejects invalid calendar dates and local times", () => {
    const result = schema.safeParse({
      ...validMostDataValues,
      workDate: "2026-02-30",
      workTime: "24:00"
    });

    expect(messagesFor(result, "workDate")).toContain(
      "Work date must be a valid date."
    );
    expect(messagesFor(result, "workTime")).toContain(
      "Work time must be a valid time."
    );
  });

  it("requires the configured Heat unit when Heat value is present", () => {
    const result = schema.safeParse({
      ...validMostDataValues,
      heatUnit: ""
    });

    expect(messagesFor(result, "heatUnit")).toContain(
      "Heat unit is required."
    );
  });

  it("requires the quantity unit when a quantity value is present", () => {
    const result = schema.safeParse({
      ...validMostDataValues,
      quantityValue: "125.5"
    });

    expect(messagesFor(result, "quantityUnit")).toContain(
      "Quantity unit is required when Quantity or reading is provided."
    );
  });

  it("requires the quantity value when a quantity unit is present", () => {
    const result = schema.safeParse({
      ...validMostDataValues,
      quantityUnit: "KG"
    });

    expect(messagesFor(result, "quantityValue")).toContain(
      "Quantity or reading is required when Quantity unit is provided."
    );
  });

  it("rejects Notes longer than the configured 2,000-character limit", () => {
    const result = schema.safeParse({
      ...validMostDataValues,
      notes: "n".repeat(2001)
    });

    expect(messagesFor(result, "notes")).toContain(
      "Notes must be 2000 characters or fewer."
    );
  });

  it("accepts ordinary Notes text with preserved line breaks", () => {
    const result = schema.safeParse({
      ...validMostDataValues,
      notes: "First observation\nSecond observation"
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe(
        "First observation\nSecond observation"
      );
    }
  });

  it("applies configured numeric range and decimal-place constraints", () => {
    const constrainedForm = {
      ...mostDataForm,
      fields: mostDataForm.fields.map((field) =>
        field.fieldKey === "heatValue"
          ? {
              ...field,
              constraints: {
                ...field.constraints,
                minValue: 0,
                maxValue: 100,
                decimalPlaces: 1
              }
            }
          : field
      )
    };
    const constrainedSchema = createDynamicFormSchema(constrainedForm);

    const result = constrainedSchema.safeParse({
      ...validMostDataValues,
      heatValue: "100.25"
    });

    expect(messagesFor(result, "heatValue")).toEqual([
      "Heat value must be 100 or less.",
      "Heat value must use no more than 1 decimal places."
    ]);
  });

  it("accepts a complete value set and an entirely empty optional pair", () => {
    expect(schema.safeParse(validMostDataValues).success).toBe(true);
    expect(
      schema.safeParse({
        ...validMostDataValues,
        quantityValue: "125.5",
        quantityUnit: "KG"
      }).success
    ).toBe(true);
  });
});
