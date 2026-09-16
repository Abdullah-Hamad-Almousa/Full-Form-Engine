import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "../auth/AuthProvider";
import { listAuditLogs } from "../services/admin";
import { adminUser, auditRow } from "../test/form-fixtures";
import { AdminAuditLogsPage } from "./AdminAuditLogsPage";

vi.mock("../auth/AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../services/admin", () => ({ listAuditLogs: vi.fn() }));

const useAuthMock = vi.mocked(useAuth);
const listAuditLogsMock = vi.mocked(listAuditLogs);

beforeEach(() => {
  useAuthMock.mockReturnValue({
    status: "authenticated",
    user: adminUser,
    login: vi.fn(),
    logout: vi.fn(),
    retrySession: vi.fn(),
    invalidateSession: vi.fn()
  });
  listAuditLogsMock.mockReset();
});

afterEach(cleanup);

describe("AdminAuditLogsPage", () => {
  it("loads the global audit collection with URL-backed approved filters", async () => {
    listAuditLogsMock.mockResolvedValue({
      data: [auditRow],
      meta: { page: 2, pageSize: 25, total: 30 }
    });
    render(
      <MemoryRouter
        initialEntries={[
          "/admin/audit-logs?page=2&entityType=SUBMISSION&entityId=submission-1"
        ]}
      >
        <AdminAuditLogsPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "Audit logs" })).toBeInTheDocument();
    expect(listAuditLogsMock).toHaveBeenCalledWith(
      {
        page: 2,
        pageSize: 25,
        entityType: "SUBMISSION",
        entityId: "submission-1"
      },
      expect.any(AbortSignal)
    );
    expect(screen.getByText("SUBMISSION_CREATED")).toBeInTheDocument();
    expect(screen.getByLabelText("Entity ID")).toHaveValue("submission-1");
  });

  it("renders the empty global audit state", async () => {
    listAuditLogsMock.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 25, total: 0 }
    });
    render(
      <MemoryRouter initialEntries={["/admin/audit-logs"]}>
        <AdminAuditLogsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("No audit logs match these filters.")).toBeInTheDocument();
  });
});
