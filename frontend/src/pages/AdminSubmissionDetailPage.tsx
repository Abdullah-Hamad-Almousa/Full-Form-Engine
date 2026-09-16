import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { AdminCorrectionForm } from "../components/AdminCorrectionForm";
import { AdminRecordActions } from "../components/AdminRecordActions";
import { AuditHistoryTable } from "../components/AuditHistoryTable";
import { PaginationControl } from "../components/PaginationControl";
import {
  getAdminSubmission,
  listAuditLogs,
  type AdminSubmissionDetail,
  type AuditCollection
} from "../services/admin";
import { ApiError } from "../services/api";
import type { FormField } from "../services/forms";

type DetailState =
  | { status: "loading" }
  | {
      status: "success";
      detail: AdminSubmissionDetail;
      refreshError?: string;
    }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { status: "error"; message: string };

type AuditState =
  | { status: "loading" }
  | { status: "success"; collection: AuditCollection; refreshError?: string }
  | { status: "error"; message: string };

const timestampFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC"
});

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC"
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 20
});

function formatResponseValue(
  field: FormField,
  value: string | number | boolean | undefined
): string {
  if (value === undefined) {
    return "Not provided";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    return numberFormatter.format(value);
  }
  if (field.inputType === "SELECT") {
    const option = field.options.find((candidate) => candidate.value === value);
    return option ? `${option.label} (${option.value})` : value;
  }
  if (field.inputType === "DATE") {
    return dateFormatter.format(new Date(`${value}T00:00:00.000Z`));
  }
  return value;
}

function describeConstraints(field: FormField): string {
  const descriptions: string[] = [];
  if (field.constraints.minValue !== null) {
    descriptions.push(`minimum ${field.constraints.minValue}`);
  }
  if (field.constraints.maxValue !== null) {
    descriptions.push(`maximum ${field.constraints.maxValue}`);
  }
  if (field.constraints.decimalPlaces !== null) {
    descriptions.push(
      `${field.constraints.decimalPlaces} decimal places maximum`
    );
  }
  if (field.constraints.maxLength !== null) {
    descriptions.push(`${field.constraints.maxLength} characters maximum`);
  }
  return descriptions.length > 0 ? descriptions.join(", ") : "No additional constraints";
}

export function AdminSubmissionDetailPage() {
  const { submissionId = "" } = useParams();
  const { invalidateSession } = useAuth();
  const [detailRetryKey, setDetailRetryKey] = useState(0);
  const [auditRetryKey, setAuditRetryKey] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [detailState, setDetailState] = useState<DetailState>({ status: "loading" });
  const [auditState, setAuditState] = useState<AuditState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void getAdminSubmission(submissionId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) {
          setDetailState({ status: "success", detail });
        }
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          invalidateSession();
          return;
        }
        if (error instanceof ApiError && error.status === 403) {
          setDetailState({ status: "forbidden" });
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setDetailState({ status: "not-found" });
          return;
        }
        setDetailState((current) =>
          current.status === "success"
            ? {
                ...current,
                refreshError: "The refreshed record could not be loaded."
              }
            : {
                status: "error",
                message: "Unable to load this submission."
              }
        );
      });
    return () => controller.abort();
  }, [detailRetryKey, invalidateSession, submissionId]);

  useEffect(() => {
    const controller = new AbortController();
    void listAuditLogs(
      {
        page: auditPage,
        pageSize: 25,
        entityType: "SUBMISSION",
        entityId: submissionId
      },
      controller.signal
    )
      .then((collection) => {
        if (!controller.signal.aborted) {
          setAuditState({ status: "success", collection });
        }
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          invalidateSession();
          return;
        }
        if (error instanceof ApiError && error.status === 403) {
          setDetailState({ status: "forbidden" });
          return;
        }
        setAuditState((current) =>
          current.status === "success"
            ? {
                ...current,
                refreshError: "The refreshed audit history could not be loaded."
              }
            : { status: "error", message: "Unable to load audit history." }
        );
      });
    return () => controller.abort();
  }, [auditPage, auditRetryKey, invalidateSession, submissionId]);

  function handleMutation(updated: AdminSubmissionDetail): void {
    setDetailState({ status: "success", detail: updated });
    setDetailRetryKey((value) => value + 1);
    setAuditRetryKey((value) => value + 1);
  }

  if (detailState.status === "forbidden") {
    return (
      <main className="status-page">
        <h1>Access denied</h1>
        <p>Admin permission is required to review this submission.</p>
        <Link to="/">Return to assigned fields</Link>
      </main>
    );
  }

  if (detailState.status === "not-found") {
    return (
      <main className="status-page">
        <h1>Submission not found</h1>
        <p>The requested submission is unavailable.</p>
        <Link to="/admin/submissions">Return to Admin submissions</Link>
      </main>
    );
  }

  if (detailState.status === "loading") {
    return (
      <main className="status-page">
        <p role="status">Loading submission detail...</p>
      </main>
    );
  }

  if (detailState.status === "error") {
    return (
      <main className="status-page">
        <h1>Unable to load this submission</h1>
        <p>{detailState.message}</p>
        <button type="button" onClick={() => setDetailRetryKey((value) => value + 1)}>
          Try again
        </button>
        <Link to="/admin/submissions">Return to Admin submissions</Link>
      </main>
    );
  }

  const detail = detailState.detail;

  return (
    <main className="app-shell admin-detail-page">
      <nav className="back-link admin-breadcrumbs" aria-label="Admin navigation">
        <Link to="/admin/submissions">Admin submissions</Link>
        <Link to="/admin/audit-logs">Audit logs</Link>
      </nav>
      <header className="page-heading">
        <p className="eyebrow">Admin review</p>
        <h1>Submission review</h1>
        <p>Review immutable metadata, historical values, state, and audit events.</p>
      </header>

      {detailState.refreshError ? (
        <div className="inline-status inline-status--error" role="alert">
          <p>{detailState.refreshError}</p>
          <button type="button" onClick={() => setDetailRetryKey((value) => value + 1)}>
            Retry record refresh
          </button>
        </div>
      ) : null}

      <section className="admin-panel" aria-labelledby="metadata-heading">
        <p className="eyebrow">Immutable record information</p>
        <h2 id="metadata-heading">Submission metadata</h2>
        <dl className="metadata-grid">
          <div>
            <dt>Submission ID</dt>
            <dd>{detail.id}</dd>
          </div>
          <div>
            <dt>Field</dt>
            <dd>{detail.field.name} ({detail.field.slug})</dd>
          </div>
          <div>
            <dt>Submitted by</dt>
            <dd>{detail.submittedBy.name} ({detail.submittedBy.username})</dd>
          </div>
          <div>
            <dt>Historical form</dt>
            <dd>Form version {detail.formVersion.versionNumber}</dd>
          </div>
          <div>
            <dt>Confirmed by</dt>
            <dd>Confirmed by {detail.confirmedBy.name} ({detail.confirmedBy.username})</dd>
          </div>
          <div>
            <dt>Confirmed at</dt>
            <dd>{timestampFormatter.format(new Date(detail.confirmedAt))}</dd>
          </div>
          <div>
            <dt>Confirmation text version</dt>
            <dd>Version {detail.confirmationTextVersion}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{timestampFormatter.format(new Date(detail.createdAt))}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{timestampFormatter.format(new Date(detail.updatedAt))}</dd>
          </div>
          <div>
            <dt>Record state</dt>
            <dd>{detail.recordState === "DELETED" ? "Deleted" : "Active"}</dd>
          </div>
          <div>
            <dt>Deleted at</dt>
            <dd>
              {detail.deletedAt
                ? timestampFormatter.format(new Date(detail.deletedAt))
                : "Not deleted"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="admin-panel" aria-labelledby="historical-values-heading">
        <p className="eyebrow">Historical form version {detail.historicalForm.versionNumber}</p>
        <h2 id="historical-values-heading">Current response values</h2>
        <dl className="historical-values">
          {detail.historicalForm.fields.map((field) => (
            <div key={field.fieldKey}>
              <dt>{field.label}</dt>
              <dd>
                <span>{formatResponseValue(field, detail.responseData[field.fieldKey])}</span>
                <span className="field-definition">
                  {field.fieldKey} · {field.inputType} · {field.required ? "Required" : "Optional"}
                </span>
                <span className="field-definition">{describeConstraints(field)}</span>
                {field.options.length > 0 ? (
                  <span className="field-definition">
                    Historical options: {field.options.map((option) => `${option.label} (${option.value})`).join(", ")}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        <details className="canonical-response">
          <summary>View canonical response data</summary>
          <pre>{JSON.stringify(detail.responseData, null, 2)}</pre>
        </details>
      </section>

      <AdminCorrectionForm
        submission={detail}
        onCorrected={handleMutation}
        onSessionExpired={invalidateSession}
      />
      <AdminRecordActions
        submission={detail}
        onMutated={handleMutation}
        onSessionExpired={invalidateSession}
      />

      <section className="admin-panel" aria-labelledby="record-audit-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Append-only history</p>
            <h2 id="record-audit-heading">Record audit history</h2>
          </div>
          <Link to={`/admin/audit-logs?entityType=SUBMISSION&entityId=${encodeURIComponent(detail.id)}`}>
            Open in global audit logs
          </Link>
        </div>
        {auditState.status === "loading" ? (
          <p role="status">Loading audit history...</p>
        ) : null}
        {auditState.status === "error" ? (
          <div className="inline-status inline-status--error" role="alert">
            <p>{auditState.message}</p>
            <button type="button" onClick={() => setAuditRetryKey((value) => value + 1)}>
              Retry audit history
            </button>
          </div>
        ) : null}
        {auditState.status === "success" ? (
          <>
            {auditState.refreshError ? (
              <div className="inline-status inline-status--error" role="alert">
                <p>{auditState.refreshError}</p>
                <button type="button" onClick={() => setAuditRetryKey((value) => value + 1)}>
                  Retry audit refresh
                </button>
              </div>
            ) : null}
            <AuditHistoryTable
              caption="Submission audit history"
              rows={auditState.collection.data}
              emptyMessage="No audit events are available for this record."
            />
            <PaginationControl
              label="Submission audit history pages"
              meta={auditState.collection.meta}
              onPageChange={setAuditPage}
            />
          </>
        ) : null}
      </section>
    </main>
  );
}
