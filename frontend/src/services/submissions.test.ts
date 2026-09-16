import { afterEach, describe, expect, it, vi } from "vitest";

import { mostDataForm, validMostDataValues } from "../test/form-fixtures";
import { ApiError } from "./api";
import {
  createSubmission,
  createSubmissionRequest
} from "./submissions";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submission request mapping", () => {
  it("maps configured fields to the exact canonical request", () => {
    const request = createSubmissionRequest(mostDataForm, {
      ...validMostDataValues,
      notes: "  Equipment checked.\nSecond line.  ",
      ignoredClientValue: "must not cross the boundary"
    });

    expect(request).toEqual({
      formVersionId: mostDataForm.formVersionId,
      confirmed: true,
      responseData: {
        workDate: validMostDataValues.workDate,
        workTime: validMostDataValues.workTime,
        locationId: validMostDataValues.locationId,
        shiftId: validMostDataValues.shiftId,
        heatValue: 42.5,
        heatUnit: validMostDataValues.heatUnit,
        status: validMostDataValues.status,
        issueDetected: false,
        notes: "Equipment checked.\nSecond line."
      }
    });
    expect(request.responseData).not.toHaveProperty("quantityValue");
    expect(request.responseData).not.toHaveProperty("quantityUnit");
    expect(request.responseData).not.toHaveProperty("ignoredClientValue");
  });

  it("preserves an optional value and unit together as canonical values", () => {
    const request = createSubmissionRequest(mostDataForm, {
      ...validMostDataValues,
      quantityValue: "125.50",
      quantityUnit: "KG",
      issueDetected: true
    });

    expect(request.responseData).toMatchObject({
      quantityValue: 125.5,
      quantityUnit: "KG",
      issueDetected: true
    });
  });

  it("refuses to map an invalid configured value", () => {
    expect(() =>
      createSubmissionRequest(mostDataForm, {
        ...validMostDataValues,
        heatValue: "Infinity"
      })
    ).toThrow("Unable to map the configured heatValue value.");
  });
});

describe("createSubmission", () => {
  it("posts to the encoded field route and strictly parses a 201 response", async () => {
    const fetchMock = vi.fn(
      async (...request: Parameters<typeof fetch>) => {
        void request;
        return jsonResponse(201, { data: { id: "submission-1" } });
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createSubmission("most data", mostDataForm, validMostDataValues)
    ).resolves.toEqual({ id: "submission-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/fields/most%20data/submissions",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.any(Headers)
      })
    );
    const options = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(options?.body))).toEqual(
      createSubmissionRequest(mostDataForm, validMostDataValues)
    );
    expect((options?.headers as Headers).get("Content-Type")).toBe(
      "application/json"
    );
  });

  it("rejects an otherwise valid envelope returned with the wrong success status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { data: { id: "submission-1" } }))
    );

    await expect(
      createSubmission("most-data", mostDataForm, validMostDataValues)
    ).rejects.toThrow("The API returned an unexpected success status.");
  });

  it.each([
    { data: { id: "" } },
    { data: { id: "submission-1", internal: true } },
    { data: { id: "submission-1" }, meta: {} }
  ])("rejects a malformed success envelope", async (body) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(201, body)));

    await expect(
      createSubmission("most-data", mostDataForm, validMostDataValues)
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("preserves the shared API error contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(422, {
          error: {
            code: "VALIDATION_FAILED",
            message: "Check the highlighted values and try again.",
            fields: { heatValue: "Enter a valid heat value." },
            requestId: "request-1"
          }
        })
      )
    );

    await expect(
      createSubmission("most-data", mostDataForm, validMostDataValues)
    ).rejects.toEqual(
      new ApiError(
        "Check the highlighted values and try again.",
        422,
        "VALIDATION_FAILED",
        { heatValue: "Enter a valid heat value." },
        "request-1"
      )
    );
  });
});
