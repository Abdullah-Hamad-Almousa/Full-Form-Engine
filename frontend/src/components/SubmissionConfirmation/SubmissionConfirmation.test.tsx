import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SubmissionConfirmation } from "./SubmissionConfirmation";

const confirmationName =
  "I have reviewed this form and confirm that all entered values are complete and correct.";

afterEach(cleanup);

describe("SubmissionConfirmation", () => {
  it.each([
    {
      name: "invalid and unchecked",
      checked: false,
      formIsValid: false,
      submissionAllowed: true,
      submitting: false,
      checkboxDisabled: false,
      submitDisabled: true,
      status:
        "Complete the required fields and confirm that the values are correct before submitting."
    },
    {
      name: "valid and unchecked",
      checked: false,
      formIsValid: true,
      submissionAllowed: true,
      submitting: false,
      checkboxDisabled: false,
      submitDisabled: true,
      status:
        "Review the entered values and confirm that they are correct before submitting."
    },
    {
      name: "invalid and checked",
      checked: true,
      formIsValid: false,
      submissionAllowed: true,
      submitting: false,
      checkboxDisabled: false,
      submitDisabled: true,
      status: "Complete the required fields before submitting."
    },
    {
      name: "valid and checked",
      checked: true,
      formIsValid: true,
      submissionAllowed: true,
      submitting: false,
      checkboxDisabled: false,
      submitDisabled: false,
      status: "Ready to submit."
    },
    {
      name: "view only",
      checked: false,
      formIsValid: true,
      submissionAllowed: false,
      submitting: false,
      checkboxDisabled: true,
      submitDisabled: true,
      status:
        "This assignment is view-only. You can review the form, but you cannot confirm or submit it."
    },
    {
      name: "submitting",
      checked: true,
      formIsValid: true,
      submissionAllowed: true,
      submitting: true,
      checkboxDisabled: true,
      submitDisabled: true,
      status: "Submitting..."
    }
  ])(
    "renders the $name state accessibly",
    ({
      checked,
      formIsValid,
      submissionAllowed,
      submitting,
      checkboxDisabled,
      submitDisabled,
      status
    }) => {
      render(
        <SubmissionConfirmation
          checked={checked}
          formIsValid={formIsValid}
          submissionAllowed={submissionAllowed}
          submitting={submitting}
          onCheckedChange={vi.fn()}
        />
      );

      const checkbox = screen.getByRole("checkbox", {
        name: confirmationName
      });
      const submit = screen.getByRole("button", { name: /submit/i });

      expect(checkbox).toHaveProperty("disabled", checkboxDisabled);
      expect(checkbox).toHaveProperty("checked", checked);
      expect(checkbox).toHaveAccessibleDescription(status);
      expect(submit).toHaveProperty("disabled", submitDisabled);
      expect(submit).toHaveAttribute("type", "submit");
      expect(screen.getByRole("status")).toHaveTextContent(status);
    }
  );

  it("supports controlled keyboard interaction", async () => {
    const user = userEvent.setup();

    function ControlledHarness() {
      const [checked, setChecked] = useState(false);
      return (
        <SubmissionConfirmation
          checked={checked}
          formIsValid
          submissionAllowed
          submitting={false}
          onCheckedChange={setChecked}
        />
      );
    }

    render(<ControlledHarness />);

    await user.tab();
    const checkbox = screen.getByRole("checkbox", { name: confirmationName });
    expect(checkbox).toHaveFocus();
    await user.keyboard(" ");

    expect(checkbox).toBeChecked();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("does not invoke the controlled callback while confirmation is disabled", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <SubmissionConfirmation
        checked={false}
        formIsValid
        submissionAllowed={false}
        submitting={false}
        onCheckedChange={onCheckedChange}
      />
    );

    await user.click(
      screen.getByRole("checkbox", { name: confirmationName })
    );

    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("locks both controls with a specific blocked-state message", () => {
    render(
      <SubmissionConfirmation
        blockedMessage="The current form must be reloaded before submission."
        checked={false}
        formIsValid
        submissionAllowed
        submitting={false}
        onCheckedChange={vi.fn()}
      />
    );

    expect(
      screen.getByRole("checkbox", { name: confirmationName })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "The current form must be reloaded before submission."
    );
  });

  it("submits through a generic parent form and gives reused instances unique associations", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <SubmissionConfirmation
          checked
          formIsValid
          submissionAllowed
          submitting={false}
          onCheckedChange={vi.fn()}
        />
        <SubmissionConfirmation
          checked={false}
          formIsValid={false}
          submissionAllowed
          submitting={false}
          onCheckedChange={vi.fn()}
        />
      </form>
    );

    const checkboxes = screen.getAllByRole("checkbox", {
      name: confirmationName
    });
    expect(checkboxes[0]).not.toHaveAttribute("id", checkboxes[1].id);
    expect(checkboxes[0].getAttribute("aria-describedby")).not.toBe(
      checkboxes[1].getAttribute("aria-describedby")
    );

    const submitButtons = screen.getAllByRole("button", { name: "Submit" });
    expect(submitButtons[0]).toBeEnabled();
    await user.click(submitButtons[0]);
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
