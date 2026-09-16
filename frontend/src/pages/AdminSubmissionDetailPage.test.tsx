import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "../auth/AuthProvider";
import { getAdminSubmission, listAuditLogs } from "../services/admin";
import {
  adminSubmissionDetail,
  adminUser,
  auditRow
} from "../test/form-fixtures";
import { AdminSubmissionDetailPage } from "./AdminSubmissionDetailPage";

vi.mock("../auth/AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../services/admin", () => ({
  getAdminSubmission: vi.fn(),
  listAuditLogs: vi.fn()
}));
vi.mock("../components/AdminCorrectionForm", () => ({
  AdminCorrectionForm: ({ onCorrected }: { onCorrected: (value: unknown) => void }) => (
    <button type="button" onClick={() => onCorrected(adminSubmissionDetail)}>
      Simulate correction
    </button>
  )
}));
vi.mock("../components/AdminRecordActions", () => ({
  AdminRecordActions: () => <div>Record actions</div>
}));

const useAuthMock = vi.mocked(useAuth);
const getAdminSubmissionMock = vi.mocked(getAdminSubmission);
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
  getAdminSubmissionMock.mockReset();
  listAuditLogsMock.mockReset();
  getAdminSubmissionMock.mockResolvedValue(adminSubmissionDetail);
  listAuditLogsMock.mockResolvedValue({
    data: [auditRow],
    meta: { page: 1, pageSize: 25, total: 1 }
  });
});

afterEach(cleanup);

describe("AdminSubmissionDetailPage", () => {
  it("shows immutable metadata, exact historical values, current state, and per-record audit", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/submissions/submission-1"]}>
        <Routes>
          <Route
            path="/admin/submissions/:submissionId"
            element={<AdminSubmissionDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "Submission review" })).toBeInTheDocument();
    expect(screen.getByText("Worker A (worker_a)")).toBeInTheDocument();
    expect(screen.getByText("Form version 1")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Equipment checked.")).toBeInTheDocument();
    expect(screen.getByText("°C - Celsius (CELSIUS)")).toBeInTheDocument();
    expect(await screen.findByText("SUBMISSION_CREATED")).toBeInTheDocument();
    expect(listAuditLogsMock).toHaveBeenCalledWith(
      {
        page: 1,
        pageSize: 25,
        entityType: "SUBMISSION",
        entityId: "submission-1"
      },
      expect.any(AbortSignal)
    );
  });

  it("refreshes both detail and audit after an Admin mutation callback", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/admin/submissions/submission-1"]}>
        <Routes>
          <Route
            path="/admin/submissions/:submissionId"
            element={<AdminSubmissionDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByRole("heading", { name: "Submission review" });

    await user.click(screen.getByRole("button", { name: "Simulate correction" }));

    await waitFor(() => expect(getAdminSubmissionMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listAuditLogsMock).toHaveBeenCalledTimes(2));
  });
});
