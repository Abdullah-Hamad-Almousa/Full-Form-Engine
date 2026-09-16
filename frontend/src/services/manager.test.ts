import { afterEach, describe, expect, it, vi } from "vitest";

import { historyRow } from "../test/form-fixtures";
import { listManagerSubmissions } from "./manager";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listManagerSubmissions", () => {
  it("requests the Manager route with only the approved scoped filters", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [historyRow],
        meta: { page: 3, pageSize: 25, total: 70 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listManagerSubmissions("most data", {
        page: 3,
        pageSize: 25,
        from: "2026-08-01",
        to: "2026-08-31",
        workerId: "worker/1"
      })
    ).resolves.toEqual({
      data: [historyRow],
      meta: { page: 3, pageSize: 25, total: 70 }
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/manager/fields/most%20data/submissions?page=3&pageSize=25&from=2026-08-01&to=2026-08-31&workerId=worker%2F1",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("strictly rejects Admin-only fields in a Manager row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: [{ ...historyRow, deletedAt: null }],
          meta: { page: 1, pageSize: 25, total: 1 }
        })
      )
    );

    await expect(
      listManagerSubmissions("most-data")
    ).rejects.toMatchObject({ name: "ZodError" });
  });
});
