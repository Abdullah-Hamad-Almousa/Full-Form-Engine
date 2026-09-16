import { zodResolver } from "@hookform/resolvers/zod";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { useForm, type FieldErrors } from "react-hook-form";

import {
  correctAdminSubmission,
  type AdminSubmissionDetail
} from "../services/admin";
import { ApiError } from "../services/api";
import { createSubmissionRequest } from "../services/submissions";
import {
  createDynamicFormDefaultValues,
  createDynamicFormSchema,
  type DynamicFormValues
} from "../validation/dynamic-form";
import { DynamicFormField } from "./DynamicFormField";

type CorrectionFeedback =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; requestId?: string };

type AdminCorrectionFormProps = {
  submission: AdminSubmissionDetail;
  onCorrected: (submission: AdminSubmissionDetail) => void;
  onSessionExpired: () => void;
};

function createCorrectionValues(
  submission: AdminSubmissionDetail
): DynamicFormValues {
  const values = createDynamicFormDefaultValues(submission.historicalForm.fields);
  for (const field of submission.historicalForm.fields) {
    const responseValue = submission.responseData[field.fieldKey];
    if (responseValue === undefined) {
      continue;
    }
    values[field.fieldKey] =
      typeof responseValue === "number" ? String(responseValue) : responseValue;
  }
  return values;
}

export function AdminCorrectionForm({
  submission,
  onCorrected,
  onSessionExpired
}: AdminCorrectionFormProps) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<CorrectionFeedback>({
    status: "idle"
  });
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const shouldFocusResult = useRef(true);
  const definition = submission.historicalForm;
  const defaultValues = useMemo(
    () => createCorrectionValues(submission),
    [submission]
  );
  const schema = useMemo(
    () => createDynamicFormSchema(definition),
    [definition]
  );
  const {
    formState: { errors },
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
    resolver: zodResolver(schema),
    shouldFocusError: true
  });
  const pending = feedback.status === "pending";
  const deleted = submission.recordState === "DELETED";

  useEffect(() => {
    if (
      (feedback.status === "success" || feedback.status === "error") &&
      shouldFocusResult.current
    ) {
      resultRef.current?.focus();
    }
    shouldFocusResult.current = true;
  }, [feedback]);

  function clearResult(): void {
    if (feedback.status !== "pending") {
      setFeedback({ status: "idle" });
    }
  }

  function validateRelatedFields(fieldKey: string): void {
    const relatedFieldKeys = definition.rules
      .filter((rule) => rule.fieldKeys.includes(fieldKey))
      .flatMap((rule) => rule.fieldKeys);
    if (relatedFieldKeys.length > 0) {
      void trigger([...new Set(relatedFieldKeys)]);
    }
  }

  function focusFirstClientError(
    clientErrors: FieldErrors<DynamicFormValues>
  ): void {
    const firstInvalidField = definition.fields.find(
      (field) => clientErrors[field.fieldKey] !== undefined
    );
    if (firstInvalidField) {
      setFocus(firstInvalidField.fieldKey);
    }
  }

  function applyServerErrors(error: ApiError): boolean {
    let firstFieldKey: string | null = null;
    let hasReasonError = false;
    for (const [publicKey, message] of Object.entries(error.fields ?? {})) {
      if (publicKey === "reason") {
        setReasonError(message);
        hasReasonError = true;
        continue;
      }
      const fieldKey = publicKey.startsWith("responseData.")
        ? publicKey.slice("responseData.".length)
        : publicKey;
      if (!definition.fields.some((field) => field.fieldKey === fieldKey)) {
        continue;
      }
      setError(fieldKey, { type: "server", message });
      firstFieldKey ??= fieldKey;
    }
    if (firstFieldKey) {
      setFocus(firstFieldKey);
      return true;
    }
    if (hasReasonError) {
      reasonRef.current?.focus();
      return true;
    }
    return false;
  }

  async function saveCorrection(values: DynamicFormValues): Promise<void> {
    const normalizedReason = reason.trim();
    if (normalizedReason.length === 0) {
      setReasonError("Enter a correction reason.");
      reasonRef.current?.focus();
      return;
    }
    if (normalizedReason.length > 500) {
      setReasonError("Correction reason must be 500 characters or fewer.");
      reasonRef.current?.focus();
      return;
    }

    setReasonError(null);
    setFeedback({ status: "pending" });
    try {
      const corrected = await correctAdminSubmission(submission.id, {
        expectedUpdatedAt: submission.updatedAt,
        reason: normalizedReason,
        responseData: createSubmissionRequest(definition, values).responseData
      });
      reset(createCorrectionValues(corrected));
      setReason("");
      setReasonError(null);
      setFeedback({
        status: "success",
        message: "Correction saved successfully."
      });
      onCorrected(corrected);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      const message =
        error instanceof ApiError
          ? error.message
          : "Unable to save the correction. Check the connection and try again.";
      setFeedback({
        status: "error",
        message,
        requestId: error instanceof ApiError ? error.requestId : undefined
      });
      if (error instanceof ApiError && applyServerErrors(error)) {
        shouldFocusResult.current = false;
        return;
      }
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>): void {
    if (pending || deleted) {
      event.preventDefault();
      return;
    }
    void handleSubmit(saveCorrection, focusFirstClientError)(event);
  }

  return (
    <section className="admin-panel" aria-labelledby="correction-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Admin change</p>
          <h2 id="correction-heading">Correct response values</h2>
        </div>
        <p>Historical form version {definition.versionNumber}</p>
      </div>
      {deleted ? (
        <p className="inline-status">Deleted records cannot be corrected.</p>
      ) : null}
      <form className="dynamic-form" noValidate onSubmit={handleFormSubmit}>
        <fieldset className="admin-fieldset" disabled={pending || deleted}>
          <legend>Corrected response data</legend>
          <div className="dynamic-form__fields">
            {definition.fields.map((field) => {
              const fieldError = errors[field.fieldKey];
              const errorMessage =
                typeof fieldError?.message === "string"
                  ? fieldError.message
                  : undefined;
              return (
                <DynamicFormField
                  key={field.fieldKey}
                  disabled={pending || deleted}
                  field={field}
                  errorMessage={errorMessage}
                  onFieldBlur={validateRelatedFields}
                  onFieldChange={clearResult}
                  register={register}
                />
              );
            })}
          </div>
          <div className="form-control form-control--full">
            <div className="form-control__heading">
              <label htmlFor="correction-reason">Correction reason</label>
              <span className="required-badge">Required</span>
            </div>
            <textarea
              ref={reasonRef}
              id="correction-reason"
              value={reason}
              maxLength={500}
              required
              disabled={pending || deleted}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? "correction-reason-error" : undefined}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError(null);
                clearResult();
              }}
            />
            {reasonError ? (
              <p
                id="correction-reason-error"
                className="field-error"
                role="alert"
              >
                {reasonError}
              </p>
            ) : null}
          </div>
        </fieldset>
        <button type="submit" disabled={pending || deleted}>
          {pending ? "Saving correction..." : "Save correction"}
        </button>
      </form>
      {feedback.status === "success" || feedback.status === "error" ? (
        <div
          ref={resultRef}
          tabIndex={-1}
          className={`inline-status inline-status--${feedback.status}`}
          role={feedback.status === "success" ? "status" : "alert"}
        >
          <p>{feedback.message}</p>
          {"requestId" in feedback && feedback.requestId ? (
            <p>Reference: {feedback.requestId}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
