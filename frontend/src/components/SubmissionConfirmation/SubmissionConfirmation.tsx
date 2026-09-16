import { useId } from "react";

type SubmissionConfirmationProps = {
  blockedMessage?: string;
  checked: boolean;
  formIsValid: boolean;
  submissionAllowed: boolean;
  submitting: boolean;
  onCheckedChange: (checked: boolean) => void;
};

function getStatusMessage({
  blockedMessage,
  checked,
  formIsValid,
  submissionAllowed,
  submitting
}: Omit<SubmissionConfirmationProps, "onCheckedChange">): string {
  if (blockedMessage) {
    return blockedMessage;
  }
  if (!submissionAllowed) {
    return "This assignment is view-only. You can review the form, but you cannot confirm or submit it.";
  }
  if (submitting) {
    return "Submitting...";
  }
  if (!formIsValid && !checked) {
    return "Complete the required fields and confirm that the values are correct before submitting.";
  }
  if (!formIsValid) {
    return "Complete the required fields before submitting.";
  }
  if (!checked) {
    return "Review the entered values and confirm that they are correct before submitting.";
  }
  return "Ready to submit.";
}

export function SubmissionConfirmation({
  blockedMessage,
  checked,
  formIsValid,
  submissionAllowed,
  submitting,
  onCheckedChange
}: SubmissionConfirmationProps) {
  const generatedId = useId();
  const headingId = `${generatedId}-confirmation-heading`;
  const checkboxId = `${generatedId}-confirmation-checkbox`;
  const statusId = `${generatedId}-confirmation-status`;
  const actionEnabled =
    checked &&
    formIsValid &&
    submissionAllowed &&
    !submitting &&
    !blockedMessage;
  const controlsDisabled =
    !submissionAllowed || submitting || Boolean(blockedMessage);
  const statusMessage = getStatusMessage({
    blockedMessage,
    checked,
    formIsValid,
    submissionAllowed,
    submitting
  });

  return (
    <section
      className="submission-confirmation"
      aria-busy={submitting || undefined}
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>Review and confirm</h2>
      <div className="checkbox-row">
        <input
          id={checkboxId}
          type="checkbox"
          checked={checked}
          disabled={controlsDisabled}
          required={submissionAllowed}
          aria-describedby={statusId}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
        <label htmlFor={checkboxId}>
          I have reviewed this form and confirm that all entered values are
          complete and correct.
        </label>
      </div>
      <p
        className="submission-confirmation__status"
        id={statusId}
        role="status"
      >
        {statusMessage}
      </p>
      <button
        type="submit"
        disabled={!actionEnabled}
        aria-describedby={statusId}
      >
        {submitting ? "Submitting..." : "Submit"}
      </button>
    </section>
  );
}
