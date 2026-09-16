import { afterEach, describe, expect, it, vi } from "vitest";

import { mostDataForm } from "../test/form-fixtures";
import { getFieldForm } from "./forms";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getFieldForm", () => {
  it("loads and parses the public form DTO from the encoded field route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: mostDataForm })
    );
    vi.stubGlobal("fetch", fetchMock);

    const definition = await getFieldForm("most data");

    expect(definition).toEqual(mostDataForm);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/fields/most%20data/form",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fails safely when a rule references a field omitted from the response", async () => {
    const malformedDefinition = {
      ...mostDataForm,
      rules: [
        {
          kind: "ALL_OR_NONE",
          fieldKeys: ["quantityValue", "inactiveField"]
        }
      ]
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: malformedDefinition }))
    );

    await expect(getFieldForm("most-data")).rejects.toMatchObject({
      name: "ZodError"
    });
  });

  it("fails safely when field keys or option values are duplicated", async () => {
    const locationField = mostDataForm.fields.find(
      (field) => field.fieldKey === "locationId"
    );
    if (!locationField) {
      throw new Error("The test form must include Location.");
    }
    const malformedDefinition = {
      ...mostDataForm,
      fields: [
        ...mostDataForm.fields,
        {
          ...locationField,
          options: [
            ...locationField.options,
            { value: "building-a", label: "Duplicate Building" }
          ]
        }
      ]
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: malformedDefinition }))
    );

    await expect(getFieldForm("most-data")).rejects.toMatchObject({
      name: "ZodError"
    });
  });
});
