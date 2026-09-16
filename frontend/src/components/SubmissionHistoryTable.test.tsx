import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { adminHistoryRow, historyRow } from "../test/form-fixtures";
import { SubmissionHistoryTable } from "./SubmissionHistoryTable";

afterEach(cleanup);

describe("SubmissionHistoryTable", () => {
  it("renders the documented semantic columns with saved historical labels and unit", () => {
    render(
      <SubmissionHistoryTable
        caption="Recent submissions"
        rows={[historyRow]}
      />
    );

    const table = screen.getByRole("table", { name: "Recent submissions" });
    for (const heading of [
      "Date",
      "Time",
      "Worker",
      "Location",
      "Shift",
      "Heat",
      "Status",
      "Confirmed"
    ]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
    expect(within(table).getByText("25 Aug 2026")).toBeInTheDocument();
    expect(within(table).getByText("08:30")).toBeInTheDocument();
    expect(within(table).getByText("Worker A")).toBeInTheDocument();
    expect(within(table).getByText("Building A")).toBeInTheDocument();
    expect(within(table).getByText("42.5 °C - Celsius")).toBeInTheDocument();
    expect(within(table).getByText("Yes")).toBeInTheDocument();
  });

  it("can add Admin state and record navigation without removing the shared columns", () => {
    render(
      <MemoryRouter>
        <SubmissionHistoryTable
          caption="Admin submissions"
          rows={[adminHistoryRow]}
          showRecordState
          getRecordHref={(row) => `/admin/submissions/${row.id}`}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole("columnheader", { name: "Record state" })).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review submission" })).toHaveAttribute(
      "href",
      "/admin/submissions/submission-1"
    );
  });

  it("renders a clear empty state instead of an empty table", () => {
    render(
      <SubmissionHistoryTable
        caption="Submission history"
        rows={[]}
        emptyMessage="No submissions match these filters."
      />
    );

    expect(screen.getByText("No submissions match these filters.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
