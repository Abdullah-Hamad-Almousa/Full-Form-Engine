import { describe, expect, it } from "vitest";

import {
  parseAdminHistoryQuery,
  parseAuditLogQuery,
  parseManagerHistoryQuery,
  parseSelfHistoryQuery
} from "./history.schema.js";

function expectValidationFailure(run: () => unknown, field: string): void {
  expect(run).toThrowError(
    expect.objectContaining({
      status: 422,
      code: "VALIDATION_FAILED",
      fields: expect.objectContaining({ [field]: expect.any(String) })
    })
  );
}

describe("history query validation", () => {
  it("applies bounded pagination and scoped defaults", () => {
    expect(parseSelfHistoryQuery({})).toEqual({
      page: 1,
      pageSize: 25,
      from: undefined,
      to: undefined
    });
    expect(parseManagerHistoryQuery({ page: "2", pageSize: "100" })).toEqual({
      page: 2,
      pageSize: 100,
      from: undefined,
      to: undefined,
      workerId: undefined
    });
    expect(parseAdminHistoryQuery({})).toEqual({
      page: 1,
      pageSize: 25,
      from: undefined,
      to: undefined,
      fieldSlug: undefined,
      userId: undefined,
      state: "ACTIVE"
    });
  });

  it("accepts exact calendar work-date ranges and all approved filters", () => {
    expect(
      parseAdminHistoryQuery({
        page: "3",
        pageSize: "10",
        from: "2024-02-29",
        to: "2026-08-25",
        fieldSlug: "most-data",
        userId: "worker-id",
        state: "ALL"
      })
    ).toEqual({
      page: 3,
      pageSize: 10,
      from: "2024-02-29",
      to: "2026-08-25",
      fieldSlug: "most-data",
      userId: "worker-id",
      state: "ALL"
    });
    expect(
      parseManagerHistoryQuery({ workerId: "worker-id", from: "2026-08-01" })
    ).toMatchObject({ workerId: "worker-id", from: "2026-08-01" });
  });

  it("rejects invalid pagination, impossible dates, and reversed ranges", () => {
    for (const value of ["0", "-1", "1.5", "01", "text", ["1"]]) {
      expectValidationFailure(() => parseSelfHistoryQuery({ page: value }), "page");
    }
    for (const value of ["0", "101", "1.5", "text", ["25"]]) {
      expectValidationFailure(
        () => parseSelfHistoryQuery({ pageSize: value }),
        "pageSize"
      );
    }
    for (const value of ["2026-02-30", "2026-8-01", "01-08-2026", ""]) {
      expectValidationFailure(() => parseSelfHistoryQuery({ from: value }), "from");
    }
    expectValidationFailure(
      () => parseSelfHistoryQuery({ from: "2026-08-26", to: "2026-08-25" }),
      "to"
    );
  });

  it("rejects unknown or cross-scope filters and invalid state values", () => {
    expectValidationFailure(
      () => parseSelfHistoryQuery({ workerId: "another-worker" }),
      "workerId"
    );
    expectValidationFailure(
      () => parseManagerHistoryQuery({ state: "ALL" }),
      "state"
    );
    expectValidationFailure(
      () => parseAdminHistoryQuery({ state: "active" }),
      "state"
    );
    expectValidationFailure(
      () => parseAdminHistoryQuery({ fieldSlug: " Not A Slug " }),
      "fieldSlug"
    );
  });
});

describe("audit query validation", () => {
  it("parses approved audit filters with pagination", () => {
    expect(
      parseAuditLogQuery({
        page: "2",
        pageSize: "50",
        entityType: "SUBMISSION",
        entityId: "submission-id"
      })
    ).toEqual({
      page: 2,
      pageSize: 50,
      entityType: "SUBMISSION",
      entityId: "submission-id"
    });
  });

  it("rejects unknown, blank, repeated, and oversized audit query values", () => {
    expectValidationFailure(() => parseAuditLogQuery({ action: "DELETE" }), "action");
    expectValidationFailure(() => parseAuditLogQuery({ entityType: "   " }), "entityType");
    expectValidationFailure(
      () => parseAuditLogQuery({ entityId: ["one", "two"] }),
      "entityId"
    );
    expectValidationFailure(
      () => parseAuditLogQuery({ entityId: "x".repeat(201) }),
      "entityId"
    );
  });
});
