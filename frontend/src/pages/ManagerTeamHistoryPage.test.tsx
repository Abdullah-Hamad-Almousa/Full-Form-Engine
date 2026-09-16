import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "../auth/AuthProvider";
import { ApiError } from "../services/api";
import { listManagerSubmissions } from "../services/manager";
import { historyRow, managerUser } from "../test/form-fixtures";
import { ManagerTeamHistoryPage } from "./ManagerTeamHistoryPage";

vi.mock("../auth/AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../services/manager", () => ({
  listManagerSubmissions: vi.fn()
}));

const useAuthMock = vi.mocked(useAuth);
const listManagerSubmissionsMock = vi.mocked(listManagerSubmissions);

beforeEach(() => {
  useAuthMock.mockReturnValue({
    status: "authenticated",
    user: managerUser,
    login: vi.fn(),
    logout: vi.fn(),
    retrySession: vi.fn(),
    invalidateSession: vi.fn()
  });
  listManagerSubmissionsMock.mockReset();
});

afterEach(cleanup);

describe("ManagerTeamHistoryPage", () => {
  it("loads only the Manager endpoint with URL-backed team filters", async () => {
    listManagerSubmissionsMock.mockResolvedValue({
      data: [historyRow],
      meta: { page: 1, pageSize: 25, total: 1 }
    });
    render(
      <MemoryRouter
        initialEntries={[
          "/manager/fields/most-data/submissions?workerId=worker-1&from=2026-08-01"
        ]}
      >
        <Routes>
          <Route
            path="/manager/fields/:fieldSlug/submissions"
            element={<ManagerTeamHistoryPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "Team submission history" })).toBeInTheDocument();
    expect(listManagerSubmissionsMock).toHaveBeenCalledWith(
      "most-data",
      {
        page: 1,
        pageSize: 25,
        from: "2026-08-01",
        workerId: "worker-1"
      },
      expect.any(AbortSignal)
    );
    expect(screen.getByLabelText("Worker ID")).toHaveValue("worker-1");
    expect(screen.getByText("Worker A")).toBeInTheDocument();
  });

  it("shows the current-assignment permission state", async () => {
    listManagerSubmissionsMock.mockRejectedValue(
      new ApiError("Field access is forbidden.", 403, "FIELD_ACCESS_FORBIDDEN")
    );
    render(
      <MemoryRouter initialEntries={["/manager/fields/most-data/submissions"]}>
        <Routes>
          <Route
            path="/manager/fields/:fieldSlug/submissions"
            element={<ManagerTeamHistoryPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
  });
});
