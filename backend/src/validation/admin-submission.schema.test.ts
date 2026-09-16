import { describe, expect, it } from "vitest";

import {
  parseAdminCorrectionBody,
  parseAdminStateChangeBody
} from "./admin-submission.schema.js";

const EXPECTED_UPDATED_AT = "2026-08-25T08:31:00.000Z";
const RESPONSE_DATA = {
  workDate: "2026-08-25",
  workTime: "08:30",
  locationId: "building-a",
  shiftId: "morning",
  heatValue: 43,
  heatUnit: "CELSIUS",
  status: "NORMAL",
  issueDetected: false
};

function expectValidationFailure(run: () => unknown, field: string): void {
  expect(run).toThrowError(
    expect.objectContaining({
      status: 422,
      code: "VALIDATION_FAILED",
      fields: expect.objectContaining({ [field]: expect.any(String) })
    })
  );
}

describe("Admin submission body validation", () => {
  it("normalizes a correction reason and retains complete replacement data", () => {
    expect(
      parseAdminCorrectionBody({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        reason: "  Corrected against the source sheet.  ",
        responseData: RESPONSE_DATA
      })
    ).toEqual({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      reason: "Corrected against the source sheet.",
      responseData: RESPONSE_DATA
    });
  });

  it("accepts the same strict concurrency and reason shape for delete and restore", () => {
    expect(
      parseAdminStateChangeBody({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        reason: "  Duplicate entry.  "
      })
    ).toEqual({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      reason: "Duplicate entry."
    });
  });

  it("requires every correction member and rejects partial or primitive response data", () => {
    const base = {
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      reason: "Correction reason",
      responseData: RESPONSE_DATA
    };
    for (const field of ["expectedUpdatedAt", "reason", "responseData"] as const) {
      const body: Record<string, unknown> = { ...base };
      delete body[field];
      expectValidationFailure(() => parseAdminCorrectionBody(body), field);
    }
    for (const responseData of [null, [], "data", 42]) {
      expectValidationFailure(
        () => parseAdminCorrectionBody({ ...base, responseData }),
        "responseData"
      );
    }
  });

  it("requires a trimmed reason from 1 through 500 characters", () => {
    for (const reason of ["", "   ", "invalid\u0000reason", "x".repeat(501), 42]) {
      expectValidationFailure(
        () =>
          parseAdminStateChangeBody({
            expectedUpdatedAt: EXPECTED_UPDATED_AT,
            reason
          }),
        "reason"
      );
    }
  });

  it("rejects invalid timestamps and unknown trusted fields", () => {
    for (const expectedUpdatedAt of [
      "2026-08-25",
      "2026-02-30T08:31:00.000Z",
      "not-a-date",
      123
    ]) {
      expectValidationFailure(
        () =>
          parseAdminStateChangeBody({
            expectedUpdatedAt,
            reason: "Valid reason"
          }),
        "expectedUpdatedAt"
      );
    }
    expectValidationFailure(
      () =>
        parseAdminCorrectionBody({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          reason: "Valid reason",
          responseData: RESPONSE_DATA,
          userId: "another-user"
        }),
      "userId"
    );
    expectValidationFailure(
      () =>
        parseAdminStateChangeBody({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          reason: "Valid reason",
          deletedAt: EXPECTED_UPDATED_AT
        }),
      "deletedAt"
    );
  });
});
