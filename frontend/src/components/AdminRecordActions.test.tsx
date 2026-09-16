import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteAdminSubmission,
  restoreAdminSubmission
} from "../services/admin";
import { adminSubmissionDetail } from "../test/form-fixtures";
import { AdminRecordActions } from "./AdminRecordActions";

vi.mock("../services/admin", () => ({
  deleteAdminSubmission: vi.fn(),
  restoreAdminSubmission: vi.fn()
}));

const deleteAdminSubmissionMock = vi.mocked(deleteAdminSubmission);
const restoreAdminSubmissionMock = vi.mocked(restoreAdminSubmission);

beforeEach(() => {
  deleteAdminSubmissionMock.mockReset();
  restoreAdminSubmissionMock.mockReset();
});

afterEach(cleanup);

describe("AdminRecordActions", () => {
  it("requires a focused two-step reason before soft deletion", async () => {
    const deleted = {
      ...adminSubmissionDetail,
      recordState: "DELETED" as const,
      deletedAt: "2026-08-25T09:00:00.000Z",
      updatedAt: "2026-08-25T09:00:00.000Z"
    };
    deleteAdminSubmissionMock.mockResolvedValue(deleted);
    const onMutated = vi.fn();
    const user = userEvent.setup();
    render(
      <AdminRecordActions
        submission={adminSubmissionDetail}
        onMutated={onMutated}
        onSessionExpired={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: "Delete record" }));
    const reason = screen.getByLabelText("Deletion reason");
    expect(reason).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Confirm deletion" }));
    expect(await screen.findByText("Enter a deletion reason.")).toBeInTheDocument();
    expect(deleteAdminSubmissionMock).not.toHaveBeenCalled();

    await user.type(reason, " Duplicate confirmed. ");
    await user.click(screen.getByRole("button", { name: "Confirm deletion" }));

    await waitFor(() => expect(deleteAdminSubmissionMock).toHaveBeenCalledOnce());
    expect(deleteAdminSubmissionMock).toHaveBeenCalledWith(
      adminSubmissionDetail.id,
      {
        expectedUpdatedAt: adminSubmissionDetail.updatedAt,
        reason: "Duplicate confirmed."
      }
    );
    expect(await screen.findByText("Record deleted successfully.")).toHaveFocus();
    expect(onMutated).toHaveBeenCalledWith(deleted);
  });

  it("uses the separate restoration endpoint for a deleted record", async () => {
    const deleted = {
      ...adminSubmissionDetail,
      recordState: "DELETED" as const,
      deletedAt: "2026-08-25T09:00:00.000Z",
      updatedAt: "2026-08-25T09:00:00.000Z"
    };
    restoreAdminSubmissionMock.mockResolvedValue({
      ...adminSubmissionDetail,
      updatedAt: "2026-08-25T09:30:00.000Z"
    });
    const user = userEvent.setup();
    render(
      <AdminRecordActions
        submission={deleted}
        onMutated={() => undefined}
        onSessionExpired={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: "Restore record" }));
    await user.type(screen.getByLabelText("Restoration reason"), "Deletion reviewed.");
    await user.click(screen.getByRole("button", { name: "Confirm restoration" }));

    await waitFor(() => expect(restoreAdminSubmissionMock).toHaveBeenCalledOnce());
    expect(deleteAdminSubmissionMock).not.toHaveBeenCalled();
  });
});
