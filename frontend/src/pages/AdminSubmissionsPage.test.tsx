import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "../auth/AuthProvider";
import { listAdminSubmissions } from "../services/admin";
import {
  adminHistoryRow,
  adminUser
} from "../test/form-fixtures";
import { AdminSubmissionsPage } from "./AdminSubmissionsPage";

vi.mock("../auth/AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../services/admin", () => ({ listAdminSubmissions: vi.fn() }));

const useAuthMock = vi.mocked(useAuth);
const listAdminSubmissionsMock = vi.mocked(listAdminSubmissions);

beforeEach(() => {
  useAuthMock.mockReturnValue({
    status: "authenticated",
    user: adminUser,
    login: vi.fn(),
    logout: vi.fn(),
    retrySession: vi.fn(),
    invalidateSession: vi.fn()
  });
  listAdminSubmissionsMock.mockReset();
});

afterEach(cleanup);

describe("AdminSubmissionsPage", () => {
  it("loads URL-backed Admin filters and exposes record detail links", async () => {
    listAdminSubmissionsMock.mockResolvedValue({
      data: [adminHistoryRow],
      meta: { page: 2, pageSize: 25, total: 26 }
    });
    render(
      <MemoryRouter
        initialEntries={[
          "/admin/submissions?page=2&fieldSlug=most-data&userId=worker-1&state=ALL&from=2026-08-01&to=2026-08-31"
        ]}
      >
        <AdminSubmissionsPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "Admin submissions" })).toBeInTheDocument();
    expect(listAdminSubmissionsMock).toHaveBeenCalledWith(
      {
        page: 2,
        pageSize: 25,
        from: "2026-08-01",
        to: "2026-08-31",
        fieldSlug: "most-data",
        userId: "worker-1",
        state: "ALL"
      },
      expect.any(AbortSignal)
    );
    expect(screen.getByRole("link", { name: "Review submission" })).toHaveAttribute(
      "href",
      "/admin/submissions/submission-1"
    );
    expect(screen.getByLabelText("Record state")).toHaveValue("ALL");
  });

  it("renders a retryable server error without stale rows", async () => {
    listAdminSubmissionsMock.mockRejectedValue(new TypeError("Network failed"));
    render(
      <MemoryRouter initialEntries={["/admin/submissions"]}>
        <AdminSubmissionsPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "Unable to load submissions" })).toBeInTheDocument();
    expect(screen.queryByText("Worker A")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
