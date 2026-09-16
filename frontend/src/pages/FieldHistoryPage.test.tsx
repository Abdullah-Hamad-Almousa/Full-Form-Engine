import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "../auth/AuthProvider";
import { ApiError } from "../services/api";
import { listSelfSubmissions } from "../services/submission-history";
import { historyRow, workerUser } from "../test/form-fixtures";
import { FieldHistoryPage } from "./FieldHistoryPage";

vi.mock("../auth/AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../services/submission-history", () => ({
  listSelfSubmissions: vi.fn()
}));

const useAuthMock = vi.mocked(useAuth);
const listSelfSubmissionsMock = vi.mocked(listSelfSubmissions);
const invalidateSession = vi.fn();

beforeEach(() => {
  invalidateSession.mockReset();
  useAuthMock.mockReturnValue({
    status: "authenticated",
    user: workerUser,
    login: vi.fn(),
    logout: vi.fn(),
    retrySession: vi.fn(),
    invalidateSession
  });
  listSelfSubmissionsMock.mockReset();
});

afterEach(cleanup);

function renderPage(path = "/fields/most-data/history") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/fields/:fieldSlug/history" element={<FieldHistoryPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("FieldHistoryPage", () => {
  it("loads URL-backed self-history filters and updates them accessibly", async () => {
    listSelfSubmissionsMock.mockResolvedValue({
      data: [historyRow],
      meta: { page: 2, pageSize: 25, total: 30 }
    });
    const user = userEvent.setup();

    renderPage("/fields/most-data/history?page=2&from=2026-08-01&to=2026-08-31");

    expect(await screen.findByRole("heading", { name: "Your submission history" })).toBeInTheDocument();
    expect(listSelfSubmissionsMock).toHaveBeenCalledWith(
      "most-data",
      {
        page: 2,
        pageSize: 25,
        from: "2026-08-01",
        to: "2026-08-31"
      },
      expect.any(AbortSignal)
    );
    expect(screen.getByText("42.5 °C - Celsius")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("From date"));
    await user.clear(screen.getByLabelText("To date"));
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => {
      expect(listSelfSubmissionsMock).toHaveBeenLastCalledWith(
        "most-data",
        { page: 1, pageSize: 25 },
        expect.any(AbortSignal)
      );
    });
  });

  it("shows permission state and invalidates an expired session", async () => {
    listSelfSubmissionsMock.mockRejectedValueOnce(
      new ApiError("Field access is forbidden.", 403, "FIELD_ACCESS_FORBIDDEN")
    );
    renderPage();
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();

    cleanup();
    listSelfSubmissionsMock.mockRejectedValueOnce(
      new ApiError("Authentication is required.", 401, "AUTHENTICATION_REQUIRED")
    );
    renderPage();
    await waitFor(() => expect(invalidateSession).toHaveBeenCalledOnce());
  });
});
