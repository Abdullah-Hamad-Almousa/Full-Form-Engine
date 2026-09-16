import { InputType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  MOST_DATA_FORM_V1,
  validateVersionedFormDefinition
} from "./form-configuration.js";

describe("Most Data version-1 form definition", () => {
  it("defines the approved fields, catalogs, constraints, and pair rules", () => {
    expect(() => validateVersionedFormDefinition(MOST_DATA_FORM_V1)).not.toThrow();
    expect(MOST_DATA_FORM_V1.fields).toHaveLength(11);
    expect(MOST_DATA_FORM_V1.fields.map(({ fieldKey }) => fieldKey)).toEqual([
      "workDate",
      "workTime",
      "locationId",
      "shiftId",
      "heatValue",
      "heatUnit",
      "status",
      "quantityValue",
      "quantityUnit",
      "issueDetected",
      "notes"
    ]);
    expect(
      MOST_DATA_FORM_V1.fields.find(({ fieldKey }) => fieldKey === "heatUnit")
    ).toMatchObject({
      inputType: InputType.SELECT,
      required: true,
      options: [
        { value: "CELSIUS", label: "°C - Celsius" },
        { value: "FAHRENHEIT", label: "°F - Fahrenheit" },
        { value: "KELVIN", label: "K - Kelvin" }
      ]
    });
    expect(
      MOST_DATA_FORM_V1.fields.find(({ fieldKey }) => fieldKey === "notes")
        ?.constraints.maxLength
    ).toBe(2_000);
    expect(MOST_DATA_FORM_V1.rules).toEqual([
      {
        kind: "REQUIRED_PAIR",
        fieldKeys: ["heatValue", "heatUnit"]
      },
      {
        kind: "ALL_OR_NONE",
        fieldKeys: ["quantityValue", "quantityUnit"]
      }
    ]);
  });
});
