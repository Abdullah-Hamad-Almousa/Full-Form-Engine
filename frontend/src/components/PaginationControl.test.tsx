import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaginationControl } from "./PaginationControl";

afterEach(cleanup);

describe("PaginationControl", () => {
  it("reports pagination metadata and requests adjacent pages", async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PaginationControl
        label="Submission history pages"
        meta={{ page: 2, pageSize: 25, total: 61 }}
        onPageChange={onPageChange}
      />
    );

    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Showing 26–50 of 61")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange.mock.calls).toEqual([[1], [3]]);
  });

  it("disables unavailable directions", () => {
    render(
      <PaginationControl
        meta={{ page: 1, pageSize: 25, total: 0 }}
        onPageChange={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});
