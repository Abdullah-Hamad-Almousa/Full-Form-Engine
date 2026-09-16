import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { auditRow } from "../test/form-fixtures";
import { AuditHistoryTable } from "./AuditHistoryTable";

afterEach(cleanup);

describe("AuditHistoryTable", () => {
  it("renders immutable actor, reason, request, and before/after data accessibly", async () => {
    const user = userEvent.setup();
    render(<AuditHistoryTable caption="Submission audit history" rows={[auditRow]} />);

    const table = screen.getByRole("table", { name: "Submission audit history" });
    expect(within(table).getByText("SUBMISSION_CREATED")).toBeInTheDocument();
    expect(within(table).getByText("Worker A")).toBeInTheDocument();
    expect(within(table).getByText("WORKER")).toBeInTheDocument();
    expect(within(table).getByText("No reason recorded")).toBeInTheDocument();
    expect(within(table).getByText("request-1")).toBeInTheDocument();
    await user.click(within(table).getByText("View recorded values"));
    expect(within(table).getByText(/"recordState": "ACTIVE"/)).toBeInTheDocument();
  });

  it("renders a clear empty state", () => {
    render(
      <AuditHistoryTable
        caption="Audit logs"
        rows={[]}
        emptyMessage="No audit logs match these filters."
      />
    );

    expect(screen.getByText("No audit logs match these filters.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
