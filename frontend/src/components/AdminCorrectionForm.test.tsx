import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { correctAdminSubmission } from "../services/admin";
import { ApiError } from "../services/api";
import { adminSubmissionDetail } from "../test/form-fixtures";
import { AdminCorrectionForm } from "./AdminCorrectionForm";

vi.mock("../services/admin", () => ({
  correctAdminSubmission: vi.fn()
}));

const correctAdminSubmissionMock = vi.mocked(correctAdminSubmission);

beforeEach(() => {
  correctAdminSubmissionMock.mockReset();
});

afterEach(cleanup);

describe("AdminCorrectionForm", () => {
  it("sends a complete canonical replacement with the concurrency token and reason", async () => {
    const corrected = {
      ...adminSubmissionDetail,
      responseData: { ...adminSubmissionDetail.responseData, heatValue: 43 },
      heat: { ...adminSubmissionDetail.heat, value: 43 },
      updatedAt: "2026-08-25T09:00:00.000Z"
    };
    correctAdminSubmissionMock.mockResolvedValue(corrected);
    const onCorrected = vi.fn();
    const user = userEvent.setup();
    render(
      <AdminCorrectionForm
        submission={adminSubmissionDetail}
        onCorrected={onCorrected}
        onSessionExpired={() => undefined}
      />
    );

    const heat = screen.getByLabelText("Heat value");
    await user.clear(heat);
    await user.type(heat, "43");
    await user.type(
      screen.getByLabelText("Correction reason"),
      " Corrected from source sheet. "
    );
    await user.click(screen.getByRole("button", { name: "Save correction" }));

    await waitFor(() => expect(correctAdminSubmissionMock).toHaveBeenCalledOnce());
    expect(correctAdminSubmissionMock).toHaveBeenCalledWith(
      adminSubmissionDetail.id,
      {
        expectedUpdatedAt: adminSubmissionDetail.updatedAt,
        reason: "Corrected from source sheet.",
        responseData: {
          ...adminSubmissionDetail.responseData,
          heatValue: 43
        }
      }
    );
    expect(await screen.findByText("Correction saved successfully.")).toBeInTheDocument();
    expect(onCorrected).toHaveBeenCalledWith(corrected);
  });

  it("preserves values and focuses the first server-invalid historical field", async () => {
    correctAdminSubmissionMock.mockRejectedValue(
      new ApiError(
        "Check the highlighted values and try again.",
        422,
        "VALIDATION_FAILED",
        { "responseData.heatValue": "Enter a reviewed heat value." }
      )
    );
    const user = userEvent.setup();
    render(
      <AdminCorrectionForm
        submission={adminSubmissionDetail}
        onCorrected={() => undefined}
        onSessionExpired={() => undefined}
      />
    );

    const heat = screen.getByLabelText("Heat value");
    await user.clear(heat);
    await user.type(heat, "43");
    await user.type(screen.getByLabelText("Correction reason"), "Reviewed source.");
    await user.click(screen.getByRole("button", { name: "Save correction" }));

    expect(await screen.findByText("Enter a reviewed heat value.")).toBeInTheDocument();
    expect(heat).toHaveValue(43);
    await waitFor(() => expect(heat).toHaveFocus());
  });

  it("requires a reason and disables correction for a deleted record", async () => {
    const user = userEvent.setup();
    const view = render(
      <AdminCorrectionForm
        submission={adminSubmissionDetail}
        onCorrected={() => undefined}
        onSessionExpired={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: "Save correction" }));
    expect(await screen.findByText("Enter a correction reason.")).toBeInTheDocument();
    expect(screen.getByLabelText("Correction reason")).toHaveFocus();
    expect(correctAdminSubmissionMock).not.toHaveBeenCalled();

    view.rerender(
      <AdminCorrectionForm
        submission={{
          ...adminSubmissionDetail,
          recordState: "DELETED",
          deletedAt: "2026-08-25T09:00:00.000Z"
        }}
        onCorrected={() => undefined}
        onSessionExpired={() => undefined}
      />
    );
    expect(screen.getByText("Deleted records cannot be corrected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
  });
});
