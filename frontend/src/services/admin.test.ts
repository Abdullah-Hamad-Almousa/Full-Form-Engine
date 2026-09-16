import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adminHistoryRow,
  adminSubmissionDetail,
  auditRow
} from "../test/form-fixtures";
import {
  correctAdminSubmission,
  deleteAdminSubmission,
  getAdminSubmission,
  listAdminSubmissions,
  listAuditLogs,
  restoreAdminSubmission
} from "./admin";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Admin reads", () => {
  it("uses the exact Admin list route and approved filters", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        data: [adminHistoryRow],
        meta: { page: 2, pageSize: 25, total: 30 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listAdminSubmissions({
        page: 2,
        pageSize: 25,
        from: "2026-08-01",
        to: "2026-08-31",
        fieldSlug: "most data",
        userId: "worker/1",
        state: "ALL"
      })
    ).resolves.toEqual({
      data: [adminHistoryRow],
      meta: { page: 2, pageSize: 25, total: 30 }
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/submissions?page=2&pageSize=25&from=2026-08-01&to=2026-08-31&fieldSlug=most+data&userId=worker%2F1&state=ALL",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("strictly parses detail and audit envelopes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { data: adminSubmissionDetail })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [auditRow],
          meta: { page: 1, pageSize: 25, total: 1 }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAdminSubmission("submission/1")).resolves.toEqual(
      adminSubmissionDetail
    );
    await expect(
      listAuditLogs({
        page: 1,
        pageSize: 25,
        entityType: "SUBMISSION",
        entityId: "submission/1"
      })
    ).resolves.toEqual({
      data: [auditRow],
      meta: { page: 1, pageSize: 25, total: 1 }
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/admin/submissions/submission%2F1"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/admin/audit-logs?page=1&pageSize=25&entityType=SUBMISSION&entityId=submission%2F1"
    );
  });

  it.each([
    { ...adminHistoryRow, deletedAt: undefined },
    { ...adminHistoryRow, recordState: "REMOVED" },
    { ...adminHistoryRow, unexpected: true }
  ])("rejects a malformed Admin row", async (row) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          data: [row],
          meta: { page: 1, pageSize: 25, total: 1 }
        })
      )
    );

    await expect(listAdminSubmissions()).rejects.toMatchObject({
      name: "ZodError"
    });
  });

  it("rejects non-canonical detail response values and malformed audit actors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            ...adminSubmissionDetail,
            responseData: { ...adminSubmissionDetail.responseData, heat: {} }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [{ ...auditRow, actorRole: "OWNER" }],
          meta: { page: 1, pageSize: 25, total: 1 }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAdminSubmission("submission-1")).rejects.toMatchObject({
      name: "ZodError"
    });
    await expect(listAuditLogs()).rejects.toMatchObject({ name: "ZodError" });
  });
});

describe("Admin mutations", () => {
  it("sends exact correction, deletion, and restoration bodies", async () => {
    const fetchMock = vi.fn(
      async (...request: Parameters<typeof fetch>) => {
        void request;
        return jsonResponse(200, { data: adminSubmissionDetail });
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    const correction = {
      expectedUpdatedAt: adminSubmissionDetail.updatedAt,
      reason: "Corrected from source sheet.",
      responseData: adminSubmissionDetail.responseData
    };
    const stateChange = {
      expectedUpdatedAt: adminSubmissionDetail.updatedAt,
      reason: "Duplicate confirmed."
    };

    await correctAdminSubmission(adminSubmissionDetail.id, correction);
    await deleteAdminSubmission(adminSubmissionDetail.id, stateChange);
    await restoreAdminSubmission(adminSubmissionDetail.id, stateChange);

    expect(fetchMock.mock.calls.map(([path, options]) => ({
      path,
      method: options?.method,
      body: JSON.parse(String(options?.body))
    }))).toEqual([
      {
        path: "/api/admin/submissions/submission-1",
        method: "PATCH",
        body: correction
      },
      {
        path: "/api/admin/submissions/submission-1",
        method: "DELETE",
        body: stateChange
      },
      {
        path: "/api/admin/submissions/submission-1/restorations",
        method: "POST",
        body: stateChange
      }
    ]);
  });

  it("rejects a mutation returned with a non-200 success status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(201, { data: adminSubmissionDetail })
      )
    );

    await expect(
      deleteAdminSubmission(adminSubmissionDetail.id, {
        expectedUpdatedAt: adminSubmissionDetail.updatedAt,
        reason: "Duplicate confirmed."
      })
    ).rejects.toThrow("The API returned an unexpected success status.");
  });
});
