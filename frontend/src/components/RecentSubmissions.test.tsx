import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../services/api";
import { listSelfSubmissions } from "../services/submission-history";
import { historyRow } from "../test/form-fixtures";
import { RecentSubmissions } from "./RecentSubmissions";

vi.mock("../services/submission-history", () => ({
  listSelfSubmissions: vi.fn()
}));

const listSelfSubmissionsMock = vi.mocked(listSelfSubmissions);

beforeEach(() => {
  listSelfSubmissionsMock.mockReset();
});

afterEach(cleanup);

function renderRecent(refreshKey = 0, onSessionExpired = vi.fn()) {
  return render(
    <MemoryRouter>
      <RecentSubmissions
        fieldSlug="most-data"
        refreshKey={refreshKey}
        onSessionExpired={onSessionExpired}
      />
    </MemoryRouter>
  );
}

describe("RecentSubmissions", () => {
  it("loads five self-history rows and links to full history", async () => {
    listSelfSubmissionsMock.mockResolvedValue({
      data: [historyRow],
      meta: { page: 1, pageSize: 5, total: 1 }
    });

    renderRecent();

    expect(screen.getByText("Loading recent submissions...")).toBeInTheDocument();
    expect(await screen.findByText("42.5 °C - Celsius")).toBeInTheDocument();
    expect(listSelfSubmissionsMock).toHaveBeenCalledWith(
      "most-data",
      { page: 1, pageSize: 5 },
      expect.any(AbortSignal)
    );
    expect(screen.getByRole("link", { name: "View full history" })).toHaveAttribute(
      "href",
      "/fields/most-data/history"
    );
  });

  it("shows independent empty and retryable error states", async () => {
    listSelfSubmissionsMock
      .mockRejectedValueOnce(new TypeError("Network failed"))
      .mockResolvedValueOnce({
        data: [],
        meta: { page: 1, pageSize: 5, total: 0 }
      });
    const user = userEvent.setup();

    renderRecent();

    expect(
      await screen.findByText("Unable to load recent submissions.")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry recent submissions" }));
    expect(await screen.findByText("No recent submissions yet.")).toBeInTheDocument();
    expect(listSelfSubmissionsMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates an expired session and reloads when the refresh key changes", async () => {
    const onSessionExpired = vi.fn();
    listSelfSubmissionsMock
      .mockResolvedValueOnce({
        data: [],
        meta: { page: 1, pageSize: 5, total: 0 }
      })
      .mockRejectedValueOnce(
        new ApiError("Authentication is required.", 401, "AUTHENTICATION_REQUIRED")
      );
    const view = renderRecent(0, onSessionExpired);
    await screen.findByText("No recent submissions yet.");

    view.rerender(
      <MemoryRouter>
        <RecentSubmissions
          fieldSlug="most-data"
          refreshKey={1}
          onSessionExpired={onSessionExpired}
        />
      </MemoryRouter>
    );

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
    expect(listSelfSubmissionsMock).toHaveBeenCalledTimes(2);
  });
});
