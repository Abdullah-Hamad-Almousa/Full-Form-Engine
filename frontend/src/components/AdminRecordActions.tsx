import { useEffect, useRef, useState } from "react";

import {
  deleteAdminSubmission,
  restoreAdminSubmission,
  type AdminSubmissionDetail
} from "../services/admin";
import { ApiError } from "../services/api";

type ActionFeedback =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; requestId?: string };

type AdminRecordActionsProps = {
  submission: AdminSubmissionDetail;
  onMutated: (submission: AdminSubmissionDetail) => void;
  onSessionExpired: () => void;
};

export function AdminRecordActions({
  submission,
  onMutated,
  onSessionExpired
}: AdminRecordActionsProps) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback>({ status: "idle" });
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const shouldFocusResult = useRef(true);
  const restoring = submission.recordState === "DELETED";
  const pending = feedback.status === "pending";
  const actionNoun = restoring ? "restoration" : "deletion";

  useEffect(() => {
    if (confirmationOpen) {
      reasonRef.current?.focus();
    }
  }, [confirmationOpen]);

  useEffect(() => {
    if (
      (feedback.status === "success" || feedback.status === "error") &&
      shouldFocusResult.current
    ) {
      resultRef.current?.focus();
    }
    shouldFocusResult.current = true;
  }, [feedback]);

  function openConfirmation(): void {
    setReason("");
    setReasonError(null);
    setFeedback({ status: "idle" });
    setConfirmationOpen(true);
  }

  function cancelConfirmation(): void {
    setConfirmationOpen(false);
    setReason("");
    setReasonError(null);
    actionButtonRef.current?.focus();
  }

  async function confirmAction(): Promise<void> {
    const normalizedReason = reason.trim();
    if (normalizedReason.length === 0) {
      setReasonError(`Enter a ${actionNoun} reason.`);
      reasonRef.current?.focus();
      return;
    }
    if (normalizedReason.length > 500) {
      setReasonError(
        `${restoring ? "Restoration" : "Deletion"} reason must be 500 characters or fewer.`
      );
      reasonRef.current?.focus();
      return;
    }

    setReasonError(null);
    setFeedback({ status: "pending" });
    try {
      const request = {
        expectedUpdatedAt: submission.updatedAt,
        reason: normalizedReason
      };
      const updated = restoring
        ? await restoreAdminSubmission(submission.id, request)
        : await deleteAdminSubmission(submission.id, request);
      setConfirmationOpen(false);
      setReason("");
      setFeedback({
        status: "success",
        message: restoring
          ? "Record restored successfully."
          : "Record deleted successfully."
      });
      onMutated(updated);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      if (error instanceof ApiError && error.fields?.reason) {
        shouldFocusResult.current = false;
        setReasonError(error.fields.reason);
        reasonRef.current?.focus();
      }
      setFeedback({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : `Unable to complete the ${actionNoun}. Check the connection and try again.`,
        requestId: error instanceof ApiError ? error.requestId : undefined
      });
    }
  }

  return (
    <section className="admin-panel admin-record-actions" aria-labelledby="record-actions-heading">
      <p className="eyebrow">Record state</p>
      <h2 id="record-actions-heading">
        {restoring ? "Restore this record" : "Delete this record"}
      </h2>
      <p>
        {restoring
          ? "Restoration returns this record to normal self and Manager history."
          : "Deletion hides this record from normal self and Manager history without permanently removing it."}
      </p>

      {!confirmationOpen ? (
        <button
          ref={actionButtonRef}
          type="button"
          className={restoring ? undefined : "button-danger"}
          onClick={openConfirmation}
          disabled={pending}
        >
          {restoring ? "Restore record" : "Delete record"}
        </button>
      ) : (
        <div className="action-confirmation">
          <p>
            {restoring
              ? "Confirm that this deleted record should become active again."
              : "Confirm that this record should be marked as deleted."}
          </p>
          <div className="form-control">
            <div className="form-control__heading">
              <label htmlFor="record-action-reason">
                {restoring ? "Restoration reason" : "Deletion reason"}
              </label>
              <span className="required-badge">Required</span>
            </div>
            <textarea
              ref={reasonRef}
              id="record-action-reason"
              value={reason}
              maxLength={500}
              required
              disabled={pending}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? "record-action-reason-error" : undefined}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError(null);
                if (feedback.status !== "pending") {
                  setFeedback({ status: "idle" });
                }
              }}
            />
            {reasonError ? (
              <p
                id="record-action-reason-error"
                className="field-error"
                role="alert"
              >
                {reasonError}
              </p>
            ) : null}
          </div>
          <div className="action-confirmation__buttons">
            <button
              type="button"
              className={restoring ? undefined : "button-danger"}
              onClick={() => void confirmAction()}
              disabled={pending}
            >
              {pending
                ? restoring
                  ? "Restoring..."
                  : "Deleting..."
                : restoring
                  ? "Confirm restoration"
                  : "Confirm deletion"}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={cancelConfirmation}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {feedback.status === "success" || feedback.status === "error" ? (
        <div className={`inline-status inline-status--${feedback.status}`}>
          <p
            ref={resultRef}
            tabIndex={-1}
            role={feedback.status === "success" ? "status" : "alert"}
          >
            {feedback.message}
          </p>
          {"requestId" in feedback && feedback.requestId ? (
            <p>Reference: {feedback.requestId}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
