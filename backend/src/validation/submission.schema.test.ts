import { InputType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { ApplicationError } from "../middleware/error-handler.js";
import type {
  PublicFormConfiguration,
  PublicFormField
} from "../services/form-configuration.service.js";
import { MOST_DATA_FORM_V1 } from "./form-configuration.js";
import {
  parseSubmissionEnvelope,
  validateAndCanonicalizeResponseData
} from "./submission.schema.js";

function testConfiguration(): PublicFormConfiguration {
  return {
    formVersionId: "form-version-id",
    versionNumber: MOST_DATA_FORM_V1.versionNumber,
    fields: MOST_DATA_FORM_V1.fields.map((field) => ({
      fieldKey: field.fieldKey,
      label: field.label,
      inputType: field.inputType as PublicFormField["inputType"],
      required: field.required,
      placeholder: field.placeholder,
      constraints: { ...field.constraints },
      options: field.options.map(({ value, label }) => ({ value, label }))
    })),
    rules: [
      {
        kind: "ALL_OR_NONE",
        fieldKeys: ["quantityValue", "quantityUnit"]
      }
    ]
  };
}

function validResponseData(): Record<string, unknown> {
  return {
    workDate: "2026-08-25",
    workTime: "08:30",
    locationId: "building-a",
    shiftId: "morning",
    heatValue: 42.5,
    heatUnit: "CELSIUS",
    status: "NORMAL",
    quantityValue: 125.5,
    quantityUnit: "KG",
    issueDetected: false,
    notes: "Equipment checked."
  };
}

function captureApplicationError(run: () => unknown): ApplicationError {
  try {
    run();
  } catch (error) {
    if (error instanceof ApplicationError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an ApplicationError.");
}

describe("submission envelope", () => {
  it("accepts only the canonical three-key envelope", () => {
    const expected = {
      formVersionId: "form-version-id",
      confirmed: true as const,
      responseData: validResponseData()
    };

    expect(parseSubmissionEnvelope(expected)).toEqual(expected);

    const extraFieldError = captureApplicationError(() =>
      parseSubmissionEnvelope({ ...expected, constructor: "untrusted-value" })
    );
    expect(extraFieldError).toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED"
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        extraFieldError.fields,
        "constructor"
      )
    ).toBe(true);
  });

  it("maps missing or false confirmation to the dedicated public error", () => {
    const responseData = validResponseData();
    for (const input of [
      { formVersionId: "form-version-id", responseData },
      { formVersionId: "form-version-id", confirmed: false, responseData }
    ]) {
      expect(
        captureApplicationError(() => parseSubmissionEnvelope(input))
      ).toMatchObject({
          status: 422,
          code: "CONFIRMATION_REQUIRED",
          fields: { confirmed: expect.any(String) }
      });
    }
  });
});

describe("published-form response validation", () => {
  it("builds a new canonical flat object and a UTC date-only value", () => {
    const source: Record<string, unknown> = {
      ...validResponseData(),
      notes: "  First line.\nSecond line.  ",
      issueDetected: false
    };

    const result = validateAndCanonicalizeResponseData(
      testConfiguration(),
      source
    );

    expect(result.workDate.toISOString()).toBe("2026-08-25T00:00:00.000Z");
    expect(result.responseData).toEqual({
      workDate: "2026-08-25",
      workTime: "08:30",
      locationId: "building-a",
      shiftId: "morning",
      heatValue: 42.5,
      heatUnit: "CELSIUS",
      status: "NORMAL",
      quantityValue: 125.5,
      quantityUnit: "KG",
      issueDetected: false,
      notes: "First line.\nSecond line."
    });
    expect(result.responseData).not.toBe(source);
  });

  it("reports exact type, date, time, option, required, and unknown-field failures", () => {
    const source: Record<string, unknown> = {
      ...validResponseData(),
      workDate: "2026-02-30",
      workTime: "24:00",
      locationId: "unknown-location",
      heatValue: "42.5",
      issueDetected: "false",
      userId: "untrusted-user"
    };
    Object.defineProperty(source, "__proto__", {
      value: "untrusted-prototype-value",
      enumerable: true
    });
    delete source.heatUnit;

    const error = captureApplicationError(() =>
      validateAndCanonicalizeResponseData(testConfiguration(), source)
    );

    expect(error).toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
      fields: {
        workDate: expect.any(String),
        workTime: expect.any(String),
        locationId: expect.any(String),
        heatValue: expect.any(String),
        heatUnit: expect.any(String),
        issueDetected: expect.any(String),
        userId: expect.any(String)
      }
    });
    expect(
      Object.prototype.hasOwnProperty.call(error.fields, "__proto__")
    ).toBe(true);
  });

  it("enforces configured numeric, text, and all-or-none pair rules", () => {
    const configuration = testConfiguration();
    const heatValue = configuration.fields.find(
      (field) => field.fieldKey === "heatValue"
    );
    if (!heatValue || heatValue.inputType !== InputType.NUMBER) {
      throw new Error("Heat value test configuration is missing.");
    }
    heatValue.constraints = {
      ...heatValue.constraints,
      minValue: 0,
      maxValue: 100,
      decimalPlaces: 2
    };

    const source: Record<string, unknown> = {
      ...validResponseData(),
      heatValue: 42.567,
      notes: "n".repeat(2_001)
    };
    delete source.quantityUnit;

    const error = captureApplicationError(() =>
      validateAndCanonicalizeResponseData(configuration, source)
    );

    expect(error).toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
      fields: {
        heatValue: expect.any(String),
        quantityUnit: expect.any(String),
        notes: expect.any(String)
      }
    });
  });

  it("rejects blank strings for non-text optional types and still enforces pairs", () => {
    const configuration = testConfiguration();
    for (const fieldKey of ["workDate", "workTime", "locationId"]) {
      const field = configuration.fields.find(
        (candidate) => candidate.fieldKey === fieldKey
      );
      if (!field) {
        throw new Error(`Test configuration is missing ${fieldKey}.`);
      }
      field.required = false;
    }

    const source: Record<string, unknown> = {
      ...validResponseData(),
      workDate: " ",
      workTime: "",
      locationId: "\t",
      quantityValue: "",
      issueDetected: " ",
      notes: " \n\t "
    };
    delete source.quantityUnit;

    const error = captureApplicationError(() =>
      validateAndCanonicalizeResponseData(configuration, source)
    );

    expect(error).toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
      fields: {
        workDate: expect.any(String),
        workTime: expect.any(String),
        locationId: expect.any(String),
        quantityValue: expect.any(String),
        quantityUnit: expect.any(String),
        issueDetected: expect.any(String)
      }
    });
    expect(error.fields).not.toHaveProperty("notes");
  });

  it("omits an optional blank textarea from canonical response data", () => {
    const result = validateAndCanonicalizeResponseData(testConfiguration(), {
      ...validResponseData(),
      notes: " \n\t "
    });

    expect(result.responseData).not.toHaveProperty("notes");
  });

  it("requires a configured required checkbox while preserving optional false", () => {
    const optionalConfiguration = testConfiguration();
    const optionalResult = validateAndCanonicalizeResponseData(
      optionalConfiguration,
      validResponseData()
    );
    expect(optionalResult.responseData.issueDetected).toBe(false);

    const requiredConfiguration = testConfiguration();
    const issueDetected = requiredConfiguration.fields.find(
      (field) => field.fieldKey === "issueDetected"
    );
    if (!issueDetected || issueDetected.inputType !== InputType.CHECKBOX) {
      throw new Error("Issue-detected test configuration is missing.");
    }
    issueDetected.required = true;

    const error = captureApplicationError(() =>
      validateAndCanonicalizeResponseData(
        requiredConfiguration,
        validResponseData()
      )
    );
    expect(error).toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
      fields: { issueDetected: expect.any(String) }
    });
  });
});
