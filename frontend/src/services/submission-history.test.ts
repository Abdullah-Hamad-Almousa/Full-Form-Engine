import { afterEach, describe, expect, it, vi } from "vitest";

import { historyRow } from "../test/form-fixtures";
import { listSelfSubmissions } from "./submission-history";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listSelfSubmissions", () => {
  it("uses only the encoded self-history route and approved URL filters", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        data: [historyRow],
        meta: { page: 2, pageSize: 5, total: 6 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listSelfSubmissions("most data", {
        page: 2,
        pageSize: 5,
        from: "2026-08-01",
        to: "2026-08-31"
      })
    ).resolves.toEqual({
      data: [historyRow],
      meta: { page: 2, pageSize: 5, total: 6 }
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/fields/most%20data/submissions/me?page=2&pageSize=5&from=2026-08-01&to=2026-08-31",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it.each([
    { ...historyRow, deletedAt: null },
    { ...historyRow, id: "" },
    { ...historyRow, workDate: "2026-02-30" },
    { ...historyRow, recordState: "DELETED" }
  ])("rejects a malformed or overexposed normal-history row", async (row) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          data: [row],
          meta: { page: 1, pageSize: 25, total: 1 }
        })
      )
    );

    await expect(listSelfSubmissions("most-data")).rejects.toMatchObject({
      name: "ZodError"
    });
  });

  it("rejects a collection returned with the wrong success status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(201, {
          data: [],
          meta: { page: 1, pageSize: 25, total: 0 }
        })
      )
    );

    await expect(listSelfSubmissions("most-data")).rejects.toThrow(
      "The API returned an unexpected success status."
    );
  });
});
