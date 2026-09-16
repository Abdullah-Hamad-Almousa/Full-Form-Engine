import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../services/api";
import { createSubmission } from "../services/submissions";
import {
  mostDataForm,
  phaseTwoUser,
  validMostDataValues
} from "../test/form-fixtures";
import { DynamicFieldForm as ProductionDynamicFieldForm } from "./DynamicFieldForm";

vi.mock("../services/submissions", () => ({
  createSubmission: vi.fn()
}));

const createSubmissionMock = vi.mocked(createSubmission);

function DynamicFieldForm(
  props: Omit<
    ComponentProps<typeof ProductionDynamicFieldForm>,
    "fieldSlug" | "onReloadForm" | "onSessionExpired"
  >
) {
  return (
    <ProductionDynamicFieldForm
      fieldSlug="most-data"
      onReloadForm={() => undefined}
      onSessionExpired={() => undefined}
      {...props}
    />
  );
}

const confirmationName =
  "I have reviewed this form and confirm that all entered values are complete and correct.";

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

async function fillValidForm(
  user: ReturnType<typeof userEvent.setup>,
  includeQuantity = false,
  submissionAllowed = true
): Promise<void> {
  await user.type(
    screen.getByLabelText("Work date"),
    validMostDataValues.workDate
  );
  await user.type(
    screen.getByLabelText("Work time"),
    validMostDataValues.workTime
  );
  await user.selectOptions(
    screen.getByLabelText("Location"),
    validMostDataValues.locationId
  );
  await user.selectOptions(
    screen.getByLabelText("Shift"),
    validMostDataValues.shiftId
  );
  await user.type(
    screen.getByLabelText("Heat value"),
    validMostDataValues.heatValue
  );
  await user.selectOptions(
    screen.getByLabelText("Heat unit"),
    validMostDataValues.heatUnit
  );
  await user.selectOptions(
    screen.getByLabelText("Status"),
    validMostDataValues.status
  );
  if (includeQuantity) {
    await user.type(screen.getByLabelText("Quantity or reading"), "125.5");
    await user.selectOptions(screen.getByLabelText("Quantity unit"), "KG");
  }
  await user.type(screen.getByLabelText("Notes"), validMostDataValues.notes);
  await user.tab();

  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent(
      submissionAllowed
        ? "Review the entered values and confirm that they are correct before submitting."
        : "This assignment is view-only."
    );
  });
}

async function createResetHarness() {
  const user = userEvent.setup();
  render(
    <DynamicFieldForm
      canSubmit
      definition={mostDataForm}
      submittedBy={phaseTwoUser}
    />
  );
  await fillValidForm(user, true);

  const confirmation = screen.getByRole("checkbox", {
    name: confirmationName
  });
  const submit = screen.getByRole("button", { name: "Submit" });

  async function confirmAgain(): Promise<void> {
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Review the entered values and confirm that they are correct before submitting."
      );
    });
    await user.click(confirmation);
    await waitFor(() => expect(submit).toBeEnabled());
  }

  async function expectResetAfter(action: () => Promise<void>): Promise<void> {
    await confirmAgain();
    await action();
    await waitFor(() => expect(confirmation).not.toBeChecked());
    expect(submit).toBeDisabled();
  }

  return { expectResetAfter, user };
}

beforeEach(() => {
  createSubmissionMock.mockReset();
  createSubmissionMock.mockResolvedValue({ id: "submission-1" });
});

afterEach(cleanup);

describe("DynamicFieldForm", () => {
  it("renders every configured input accessibly and returned option labels verbatim", () => {
    render(
      <DynamicFieldForm
        canSubmit
        definition={mostDataForm}
        submittedBy={phaseTwoUser}
      />
    );

    expect(screen.getByLabelText("Work date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Work time")).toHaveAttribute("type", "time");
    expect(screen.getByLabelText("Location")).toBeRequired();
    expect(screen.getByLabelText("Shift")).toBeRequired();
    expect(screen.getByLabelText("Heat value")).toHaveAttribute(
      "type",
      "number"
    );
    expect(screen.getByLabelText("Heat unit")).toBeRequired();
    expect(screen.getByRole("option", { name: "°C - Celsius" })).toHaveValue(
      "CELSIUS"
    );
    expect(screen.getByRole("option", { name: "°F - Fahrenheit" })).toHaveValue(
      "FAHRENHEIT"
    );
    expect(screen.getByRole("option", { name: "K - Kelvin" })).toHaveValue(
      "KELVIN"
    );
    expect(screen.getByLabelText("Status")).toBeRequired();
    expect(screen.getByLabelText("Quantity or reading")).not.toBeRequired();
    expect(screen.getByLabelText("Quantity unit")).not.toBeRequired();
    expect(
      screen.getByRole("checkbox", { name: "Issue detected" })
    ).not.toBeChecked();
    expect(screen.getByLabelText("Notes").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Notes")).toHaveAttribute(
      "maxlength",
      "2000"
    );
  });

  it("shows Submitted by and the initial submission state", () => {
    render(
      <DynamicFieldForm
        canSubmit
        definition={mostDataForm}
        submittedBy={phaseTwoUser}
      />
    );

    expect(screen.getByLabelText("Submitted by")).toHaveValue(
      phaseTwoUser.name
    );
    expect(screen.getByLabelText("Submitted by")).toHaveAttribute("readonly");
    expect(screen.getByRole("checkbox", { name: confirmationName })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: confirmationName })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    expect(screen.queryByText(/not sent or saved/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /recent submissions/i })
    ).not.toBeInTheDocument();
  });

  it("keeps a view-only form readable while disabling confirmation and Submit", () => {
    render(
      <DynamicFieldForm
        canSubmit={false}
        definition={mostDataForm}
        submittedBy={phaseTwoUser}
      />
    );

    expect(screen.getByLabelText("Work date")).toBeEnabled();
    expect(screen.getByLabelText("Submitted by")).toHaveValue(phaseTwoUser.name);
    expect(screen.getByRole("checkbox", { name: confirmationName })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "This assignment is view-only."
    );
  });

  it("requires fresh confirmation after assignment permission changes", async () => {
    const user = userEvent.setup();
    function form(canSubmit: boolean) {
      return (
        <DynamicFieldForm
          key={`${mostDataForm.formVersionId}:${canSubmit ? "submit" : "view"}`}
          canSubmit={canSubmit}
          definition={mostDataForm}
          submittedBy={phaseTwoUser}
        />
      );
    }
    const { rerender } = render(form(true));
    await fillValidForm(user);

    await user.click(
      screen.getByRole("checkbox", { name: confirmationName })
    );
    const submit = screen.getByRole("button", { name: "Submit" });
    await waitFor(() => expect(submit).toBeEnabled());

    rerender(form(false));
    expect(
      screen.getByRole("checkbox", { name: confirmationName })
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: confirmationName })
    ).not.toBeChecked();
    expect(createSubmissionMock).not.toHaveBeenCalled();

    rerender(form(true));
    expect(
      screen.getByRole("checkbox", { name: confirmationName })
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });

  it("submits valid confirmed values and resets only after success", async () => {
    const user = userEvent.setup();
    render(
      <DynamicFieldForm
        canSubmit
        definition={mostDataForm}
        submittedBy={phaseTwoUser}
      />
    );

    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();

    await fillValidForm(user);
    expect(submit).toBeDisabled();

    const confirmation = screen.getByRole("checkbox", {
      name: confirmationName
    });
    await user.click(confirmation);
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(screen.getByLabelText("Work date"));
    await user.keyboard("{Enter}");

    expect(
      await screen.findByText("Submission saved successfully.")
    ).toBeInTheDocument();
    expect(createSubmissionMock).toHaveBeenCalledOnce();
    expect(createSubmissionMock).toHaveBeenCalledWith(
      "most-data",
      mostDataForm,
      expect.objectContaining(validMostDataValues)
    );
    expect(confirmation).not.toBeChecked();
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText("Work date")).toHaveValue("");
    expect(screen.getByLabelText("Notes")).toHaveValue("");
  });

  it("invokes the optional creation callback only after verified success and reset", async () => {
    const request = deferred<{ id: string }>();
    createSubmissionMock.mockReturnValue(request.promise);
    const onSubmissionCreated = vi.fn(() => {
      expect(screen.getByText("Submission saved successfully.")).toBeInTheDocument();
      expect(screen.getByLabelText("Work date")).toHaveValue("");
    });
    const user = userEvent.setup();
    render(
      <DynamicFieldForm
        canSubmit
        definition={mostDataForm}
        onSubmissionCreated={onSubmissionCreated}
        submittedBy={phaseTwoUser}
      />
    );
    await fillValidForm(user);
    await user.click(screen.getByRole("checkbox", { name: confirmationName }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmissionCreated).not.toHaveBeenCalled();

    await act(async () => {
      request.resolve({ id: "submission-1" });
      await request.promise;
    });

    await waitFor(() => {
      expect(onSubmissionCreated).toHaveBeenCalledWith({ id: "submission-1" });
    });
  });

  it.each([
    {
      state: "invalid values",
      canSubmit: true,
      fillForm: false,
      confirm: true
    },
    {
      state: "unchecked confirmation",
      canSubmit: true,
      fillForm: true,
      confirm: false
    },
    {
      state: "view-only permission",
      canSubmit: false,
      fillForm: true,
      confirm: false
    }
  ])(
    "does not let Enter bypass $state",
    async ({ canSubmit, fillForm, confirm }) => {
      const user = userEvent.setup();
      render(
        <DynamicFieldForm
          canSubmit={canSubmit}
          definition={mostDataForm}
          submittedBy={phaseTwoUser}
        />
      );
      if (fillForm) {
        await fillValidForm(user, false, canSubmit);
      }
      if (confirm) {
        await user.click(
          screen.getByRole("checkbox", { name: confirmationName })
        );
      }

      await user.click(screen.getByLabelText("Work date"));
      await user.keyboard("{Enter}");

      expect(createSubmissionMock).not.toHaveBeenCalled();
    }
  );

  it("clears confirmation after date, time, number, and select changes", async () => {
    const { expectResetAfter, user } = await createResetHarness();

    await expectResetAfter(async () => {
      const control = screen.getByLabelText("Work date");
      await user.clear(control);
      await user.type(control, "2026-08-26");
      await user.tab();
      expect(control).toHaveValue("2026-08-26");
    });
    await expectResetAfter(async () => {
      const control = screen.getByLabelText("Work time");
      await user.clear(control);
      await user.type(control, "09:15");
      await user.tab();
      expect(control).toHaveValue("09:15");
    });
    await expectResetAfter(async () => {
      const control = screen.getByLabelText("Heat value");
      await user.clear(control);
      await user.type(control, "43");
      await user.tab();
      expect(control).toHaveValue(43);
    });
    await expectResetAfter(async () => {
      await user.selectOptions(screen.getByLabelText("Heat unit"), "FAHRENHEIT");
    });
    await expectResetAfter(async () => {
      await user.selectOptions(screen.getByLabelText("Status"), "WARNING");
    });
  });

  it("clears confirmation after checkbox, text, and quantity-pair changes", async () => {
    const { expectResetAfter, user } = await createResetHarness();

    await expectResetAfter(async () => {
      await user.click(screen.getByRole("checkbox", { name: "Issue detected" }));
    });
    await expectResetAfter(async () => {
      await user.type(screen.getByLabelText("Notes"), " Updated.");
    });
    await expectResetAfter(async () => {
      const control = screen.getByLabelText("Quantity or reading");
      await user.clear(control);
      await user.type(control, "126");
      await user.tab();
      expect(control).toHaveValue(126);
    });
    await expectResetAfter(async () => {
      await user.selectOptions(screen.getByLabelText("Quantity unit"), "");
    });
  });

  it("does not clear confirmation for checking itself, blur, or validation-only changes", async () => {
    const user = userEvent.setup();
    render(
      <DynamicFieldForm
        canSubmit
        definition={mostDataForm}
        submittedBy={phaseTwoUser}
      />
    );

    const confirmation = screen.getByRole("checkbox", {
      name: confirmationName
    });
    await user.click(confirmation);
    expect(confirmation).toBeChecked();

    const workDate = screen.getByLabelText("Work date");
    await user.click(workDate);
    await user.tab();
    expect(await screen.findByText("Work date is required.")).toBeInTheDocument();
    expect(confirmation).toBeChecked();

    await user.click(screen.getByLabelText("Submitted by"));
    await user.tab();
    expect(confirmation).toBeChecked();
  });

  it("shows connected validation errors without erasing entered values", async () => {
    const user = userEvent.setup();
    render(
      <DynamicFieldForm
        canSubmit
        definition={mostDataForm}
        submittedBy={phaseTwoUser}
      />
    );
    const workDate = screen.getByLabelText("Work date");
    const quantityValue = screen.getByLabelText("Quantity or reading");

    await user.click(workDate);
    await user.tab();
    const requiredError = await screen.findByText("Work date is required.");
    expect(workDate).toHaveAttribute("aria-describedby", requiredError.id);
    expect(workDate).toHaveAttribute("aria-invalid", "true");

    await user.type(quantityValue, "125.5");
    await user.tab();
    expect(
      await screen.findByText(
        "Quantity unit is required when Quantity or reading is provided."
      )
    ).toBeInTheDocument();
    expect(quantityValue).toHaveValue(125.5);

    await user.selectOptions(screen.getByLabelText("Quantity unit"), "KG");
    await user.tab();
    await waitFor(() => {
      expect(
        screen.queryByText(
          "Quantity unit is required when Quantity or reading is provided."
        )
      ).not.toBeInTheDocument();
    });
    expect(quantityValue).toHaveValue(125.5);
  });

  it("acquires a synchronous single-flight lock and exposes real pending state", async () => {
    const pendingSubmission = deferred<{ id: string }>();
    createSubmissionMock.mockReturnValue(pendingSubmission.promise);
    const user = userEvent.setup();
    render(
      <DynamicFieldForm
        canSubmit
        definition={mostDataForm}
        submittedBy={phaseTwoUser}
      />
    );
    await fillValidForm(user);
    const confirmation = screen.getByRole("checkbox", {
      name: confirmationName
    });
    const notes = screen.getByLabelText("Notes");
    await user.click(confirmation);
    const form = screen.getByRole("form", { name: "Data entry" });

    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(createSubmissionMock).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();
    for (const field of mostDataForm.fields) {
      expect(screen.getByLabelText(field.label)).toBeDisabled();
    }
    expect(confirmation).toBeChecked();
    expect(confirmation).toBeDisabled();

    await user.type(notes, " changed while pending");
    await user.click(confirmation);
    expect(notes).toHaveValue(validMostDataValues.notes);
    expect(confirmation).toBeChecked();

    await act(async () => {
      pendingSubmission.resolve({ id: "submission-1" });
      await pendingSubmission.promise;
    });
    expect(
      await screen.findByText("Submission saved successfully.")
    ).toBeInTheDocument();
    expect(notes).toBeEnabled();
    expect(notes).toHaveValue("");
    expect(confirmation).not.toBeChecked();
    expect(createSubmissionMock).toHaveBeenCalledOnce();
  });

  it("maps a 422 field error, clears confirmation, and preserves values", async () => {
    const request = deferred<{ id: string }>();
    createSubmissionMock.mockReturnValue(request.promise);
    const user = userEvent.setup();
    render(
      <DynamicFieldForm
        canSubmit
        definition={mostDataForm}
        submittedBy={phaseTwoUser}
      />
    );
    await fillValidForm(user);
    const confirmation = screen.getByRole("checkbox", {
      name: confirmationName
    });
    await user.click(confirmation);
    const form = screen.getByRole("form", { name: "Data entry" });
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(createSubmissionMock).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Heat value")).toBeDisabled();

    await act(async () => {
      request.reject(
        new ApiError(
          "Check the highlighted values and try again.",
          422,
          "VALIDATION_FAILED",
          { heatValue: "Enter a current heat value." },
          "request-422"
        )
      );
      await Promise.resolve();
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });

    const fieldError = await screen.findByText("Enter a current heat value.");
    expect(screen.getByLabelText("Heat value")).toHaveAttribute(
      "aria-describedby",
      fieldError.id
    );
    expect(screen.getByLabelText("Heat value")).toHaveFocus();
    expect(screen.getByLabelText("Work date")).toHaveValue(
      validMostDataValues.workDate
    );
    expect(screen.getByLabelText("Notes")).toHaveValue(
      validMostDataValues.notes
    );
    expect(confirmation).not.toBeChecked();
    expect(screen.getByText("Reference: request-422")).toBeInTheDocument();
    expect(createSubmissionMock).toHaveBeenCalledOnce();
  });

  it("locks a permission rejection without erasing entered values", async () => {
    createSubmissionMock.mockRejectedValue(
      new ApiError(
        "You do not have permission to submit to this field.",
        403,
        "FIELD_SUBMISSION_FORBIDDEN",
        undefined,
        "request-403"
      )
    );
    const user = userEvent.setup();
    render(
      <DynamicFieldForm
        canSubmit
        definition={mostDataForm}
        submittedBy={phaseTwoUser}
      />
    );
    await fillValidForm(user);
    const confirmation = screen.getByRole("checkbox", {
      name: confirmationName
    });
    await user.click(confirmation);
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(
      await screen.findByText(
        "You do not have permission to submit to this field."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Work date")).toHaveValue(
      validMostDataValues.workDate
    );
    expect(confirmation).not.toBeChecked();
    expect(confirmation).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Data entry" }));
    expect(createSubmissionMock).toHaveBeenCalledOnce();
  });

  it("locks a stale form and delegates only an explicit reload", async () => {
    const request = deferred<{ id: string }>();
    createSubmissionMock.mockReturnValue(request.promise);
    const onReloadForm = vi.fn();
    const user = userEvent.setup();
    render(
      <ProductionDynamicFieldForm
        canSubmit
        definition={mostDataForm}
        fieldSlug="most-data"
        onReloadForm={onReloadForm}
        onSessionExpired={vi.fn()}
        submittedBy={phaseTwoUser}
      />
    );
    await fillValidForm(user);
    const confirmation = screen.getByRole("checkbox", {
      name: confirmationName
    });
    const notes = screen.getByLabelText("Notes");
    await user.click(confirmation);
    const form = screen.getByRole("form", { name: "Data entry" });
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(createSubmissionMock).toHaveBeenCalledOnce());
    expect(notes).toBeDisabled();
    expect(confirmation).toBeChecked();
    await user.type(notes, " changed while pending");
    expect(notes).toHaveValue(validMostDataValues.notes);
    expect(confirmation).toBeChecked();

    await act(async () => {
      request.reject(
        new ApiError(
          "The form has changed. Reload it before submitting again.",
          409,
          "FORM_VERSION_NOT_CURRENT",
          { formVersionId: "This form version is no longer current." },
          "request-409"
        )
      );
      await Promise.resolve();
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });

    expect(
      await screen.findByText(
        "The form has changed. Reload it before submitting again."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Work date")).toHaveValue(
      validMostDataValues.workDate
    );
    expect(createSubmissionMock).toHaveBeenCalledOnce();
    expect(onReloadForm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Reload form" }));
    expect(onReloadForm).toHaveBeenCalledOnce();
  });

  it("invalidates the established session after a submission 401", async () => {
    createSubmissionMock.mockRejectedValue(
      new ApiError(
        "Authentication is required.",
        401,
        "AUTHENTICATION_REQUIRED",
        undefined,
        "request-401"
      )
    );
    const onSessionExpired = vi.fn();
    const user = userEvent.setup();
    render(
      <ProductionDynamicFieldForm
        canSubmit
        definition={mostDataForm}
        fieldSlug="most-data"
        onReloadForm={vi.fn()}
        onSessionExpired={onSessionExpired}
        submittedBy={phaseTwoUser}
      />
    );
    await fillValidForm(user);
    await user.click(
      screen.getByRole("checkbox", { name: confirmationName })
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
    expect(screen.queryByText("Submission saved successfully.")).not.toBeInTheDocument();
  });

  it("locks an outcome-unknown result without retrying or erasing values", async () => {
    const request = deferred<{ id: string }>();
    createSubmissionMock.mockReturnValue(request.promise);
    const user = userEvent.setup();
    render(
      <DynamicFieldForm
        canSubmit
        definition={mostDataForm}
        submittedBy={phaseTwoUser}
      />
    );
    await fillValidForm(user);
    const confirmation = screen.getByRole("checkbox", {
      name: confirmationName
    });
    const notes = screen.getByLabelText("Notes");
    await user.click(confirmation);
    const form = screen.getByRole("form", { name: "Data entry" });
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(createSubmissionMock).toHaveBeenCalledOnce());
    expect(notes).toBeDisabled();
    expect(confirmation).toBeChecked();
    await user.type(notes, " changed while pending");
    expect(notes).toHaveValue(validMostDataValues.notes);
    expect(confirmation).toBeChecked();

    await act(async () => {
      request.reject(new TypeError("Network failed."));
      await Promise.resolve();
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });

    expect(
      await screen.findByText(
        "The submission result is unknown. Do not submit these values again until you can verify whether they were saved."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Work date")).toHaveValue(
      validMostDataValues.workDate
    );
    expect(notes).toBeEnabled();
    expect(notes).toHaveValue(validMostDataValues.notes);
    expect(confirmation).not.toBeChecked();
    expect(confirmation).toBeDisabled();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    fireEvent.submit(form);
    expect(createSubmissionMock).toHaveBeenCalledOnce();
  });
});
