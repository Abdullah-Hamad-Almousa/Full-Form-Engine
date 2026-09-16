import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";

import { ApiError } from "../services/api";
import type { AuthenticatedUser } from "../services/auth";
import type { FormDefinition } from "../services/forms";
import {
  createSubmission,
  type CreatedSubmission
} from "../services/submissions";
import {
  createDynamicFormDefaultValues,
  createDynamicFormSchema,
  type DynamicFormValues
} from "../validation/dynamic-form";
import { DynamicFormField } from "./DynamicFormField";
import { SubmissionConfirmation } from "./SubmissionConfirmation/SubmissionConfirmation";

const OUTCOME_UNKNOWN_MESSAGE =
  "The submission result is unknown. Do not submit these values again until you can verify whether they were saved.";

type SubmissionFeedback =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success"; message: string }
  | { kind: "validation"; message: string; requestId?: string }
  | {
      kind: "blocked";
      reason: "permission" | "stale";
      message: string;
      requestId?: string;
    }
  | { kind: "unknown"; message: string; requestId?: string };

type DynamicFieldFormProps = {
  canSubmit: boolean;
  definition: FormDefinition;
  fieldSlug: string;
  onReloadForm: () => void;
  onSessionExpired: () => void;
  onSubmissionCreated?: (submission: CreatedSubmission) => void;
  submittedBy: AuthenticatedUser;
};

export function DynamicFieldForm({
  canSubmit,
  definition,
  fieldSlug,
  onReloadForm,
  onSessionExpired,
  onSubmissionCreated,
  submittedBy
}: DynamicFieldFormProps) {
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [submissionFeedback, setSubmissionFeedback] =
    useState<SubmissionFeedback>({ kind: "idle" });
  const submissionInFlight = useRef(false);
  const serverErrorFocusTarget = useRef<string | null>(null);
  const createdSubmissionForCallback = useRef<CreatedSubmission | null>(null);
  const schema = useMemo(
    () => createDynamicFormSchema(definition),
    [definition]
  );
  const defaultValues = useMemo(
    () => createDynamicFormDefaultValues(definition.fields),
    [definition.fields]
  );
  const configuredFieldKeys = useMemo(
    () => new Set(definition.fields.map(({ fieldKey }) => fieldKey)),
    [definition.fields]
  );
  const {
    formState: { errors, isValid },
    handleSubmit,
    register,
    reset,
    setError,
    setFocus,
    trigger
  } = useForm<DynamicFormValues>({
    defaultValues,
    mode: "onBlur",
    reValidateMode: "onChange",
    resolver: zodResolver(schema)
  });

  const submitting = submissionFeedback.kind === "pending";
  const submissionLocked =
    submissionFeedback.kind === "blocked" ||
    submissionFeedback.kind === "unknown";
  const blockedMessage =
    submissionFeedback.kind === "unknown"
      ? "Submission is locked because the result is unknown."
      : submissionFeedback.kind === "blocked" &&
          submissionFeedback.reason === "stale"
        ? "This form must be reloaded before submitting."
        : submissionFeedback.kind === "blocked"
          ? "Submission is unavailable for this form."
          : undefined;

  useEffect(() => {
    if (
      submissionFeedback.kind === "success" ||
      submissionFeedback.kind === "validation"
    ) {
      submissionInFlight.current = false;
    }

    if (
      submissionFeedback.kind === "success" &&
      createdSubmissionForCallback.current
    ) {
      const createdSubmission = createdSubmissionForCallback.current;
      createdSubmissionForCallback.current = null;
      onSubmissionCreated?.(createdSubmission);
    }

    if (
      submissionFeedback.kind === "validation" &&
      serverErrorFocusTarget.current
    ) {
      const fieldKey = serverErrorFocusTarget.current;
      serverErrorFocusTarget.current = null;
      setFocus(fieldKey);
    }
  }, [onSubmissionCreated, setFocus, submissionFeedback.kind]);

  function handleResponseValueChange(): void {
    setIsConfirmed(false);
    if (
      submissionFeedback.kind !== "pending" &&
      submissionFeedback.kind !== "blocked" &&
      submissionFeedback.kind !== "unknown"
    ) {
      setSubmissionFeedback({ kind: "idle" });
    }
  }

  function handleConfirmationChange(checked: boolean): void {
    setIsConfirmed(checked);
    if (!checked && submissionFeedback.kind === "success") {
      setSubmissionFeedback({ kind: "idle" });
    }
  }

  function applyServerFieldErrors(fields?: Record<string, string>): void {
    let firstFieldKey: string | null = null;

    for (const [publicKey, message] of Object.entries(fields ?? {})) {
      const fieldKey = publicKey.startsWith("responseData.")
        ? publicKey.slice("responseData.".length)
        : publicKey;
      if (!configuredFieldKeys.has(fieldKey)) {
        continue;
      }
      setError(fieldKey, { type: "server", message });
      firstFieldKey ??= fieldKey;
    }

    serverErrorFocusTarget.current = firstFieldKey;
  }

  async function submitForm(values: DynamicFormValues): Promise<void> {
    setSubmissionFeedback({ kind: "pending" });

    try {
      const createdSubmission = await createSubmission(
        fieldSlug,
        definition,
        values
      );
      reset(defaultValues);
      setIsConfirmed(false);
      createdSubmissionForCallback.current = createdSubmission;
      setSubmissionFeedback({
        kind: "success",
        message: "Submission saved successfully."
      });
    } catch (error) {
      setIsConfirmed(false);

      if (error instanceof ApiError) {
        if (error.status === 401) {
          setSubmissionFeedback({
            kind: "blocked",
            reason: "permission",
            message: "Your session has expired. Sign in again to continue.",
            requestId: error.requestId
          });
          onSessionExpired();
          return;
        }

        if (error.status === 422 || error.status === 400) {
          applyServerFieldErrors(error.fields);
          setSubmissionFeedback({
            kind: "validation",
            message: error.message,
            requestId: error.requestId
          });
          return;
        }

        if (error.status === 403 || error.status === 404) {
          setSubmissionFeedback({
            kind: "blocked",
            reason: "permission",
            message: error.message,
            requestId: error.requestId
          });
          return;
        }

        if (error.status === 409) {
          setSubmissionFeedback({
            kind: "blocked",
            reason: "stale",
            message: error.message,
            requestId: error.requestId
          });
          return;
        }

        if (error.status < 500) {
          setSubmissionFeedback({
            kind: "validation",
            message: error.message,
            requestId: error.requestId
          });
          return;
        }
      }

      setSubmissionFeedback({
        kind: "unknown",
        message: OUTCOME_UNKNOWN_MESSAGE,
        requestId: error instanceof ApiError ? error.requestId : undefined
      });
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>): void {
    if (
      !canSubmit ||
      !isConfirmed ||
      submissionLocked ||
      submissionInFlight.current
    ) {
      event.preventDefault();
      return;
    }

    submissionInFlight.current = true;
    void handleSubmit(submitForm, () => {
      submissionInFlight.current = false;
    })(event);
  }

  function validateRelatedFields(fieldKey: string): void {
    const relatedFieldKeys = definition.rules
      .filter((rule) => rule.fieldKeys.includes(fieldKey))
      .flatMap((rule) => rule.fieldKeys);
    if (relatedFieldKeys.length > 0) {
      void trigger([...new Set(relatedFieldKeys)]);
    }
  }

  return (
    <div className="form-preview">
      <form
        className="dynamic-form"
        aria-labelledby="form-preview-heading"
        noValidate
        onSubmit={handleFormSubmit}
      >
        <div className="form-preview__heading">
          <div>
            <h2 id="form-preview-heading">Data entry</h2>
            <p>Form version {definition.versionNumber}</p>
          </div>
          <p className="required-help">
            Fields marked <span className="required-badge">Required</span> must
            be completed.
          </p>
        </div>

        <div className="form-control">
          <div className="form-control__heading">
            <label htmlFor="submitted-by">Submitted by</label>
            <span className="required-badge">Required</span>
          </div>
          <input
            id="submitted-by"
            name="submittedBy"
            value={submittedBy.name}
            readOnly
            aria-readonly="true"
          />
          <p className="field-help">Signed in as {submittedBy.username}</p>
        </div>

        <div className="dynamic-form__fields">
          {definition.fields.map((field) => {
            const error = errors[field.fieldKey];
            const errorMessage =
              typeof error?.message === "string" ? error.message : undefined;
            return (
              <DynamicFormField
                key={field.fieldKey}
                disabled={submitting}
                field={field}
                errorMessage={errorMessage}
                onFieldBlur={validateRelatedFields}
                onFieldChange={handleResponseValueChange}
                register={register}
              />
            );
          })}
        </div>

        <SubmissionConfirmation
          checked={isConfirmed}
          formIsValid={isValid}
          submissionAllowed={canSubmit}
          submitting={submitting}
          blockedMessage={blockedMessage}
          onCheckedChange={handleConfirmationChange}
        />

        {submissionFeedback.kind !== "idle" &&
        submissionFeedback.kind !== "pending" ? (
          <div
            className={`submission-result submission-result--${submissionFeedback.kind}`}
            role={submissionFeedback.kind === "success" ? "status" : "alert"}
          >
            <p>{submissionFeedback.message}</p>
            {"requestId" in submissionFeedback &&
            submissionFeedback.requestId ? (
              <p className="submission-result__reference">
                Reference: {submissionFeedback.requestId}
              </p>
            ) : null}
            {submissionFeedback.kind === "blocked" &&
            submissionFeedback.reason === "stale" ? (
              <button type="button" onClick={onReloadForm}>
                Reload form
              </button>
            ) : null}
          </div>
        ) : null}
      </form>
    </div>
  );
}
