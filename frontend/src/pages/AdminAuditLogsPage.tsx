import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { AuditHistoryTable } from "../components/AuditHistoryTable";
import { PaginationControl } from "../components/PaginationControl";
import {
  listAuditLogs,
  type AuditCollection,
  type AuditFilters
} from "../services/admin";
import { ApiError } from "../services/api";

type AuditPageResult =
  | { status: "success"; collection: AuditCollection; requestKey: string }
  | { status: "forbidden"; requestKey: string }
  | { status: "error"; message: string; requestKey: string };

function parsePage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) {
    return 1;
  }
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function AdminAuditLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { invalidateSession } = useAuth();
  const page = parsePage(searchParams.get("page"));
  const entityType = searchParams.get("entityType") ?? "";
  const entityId = searchParams.get("entityId") ?? "";
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${page}:${entityType}:${entityId}:${retryKey}`;
  const [result, setResult] = useState<AuditPageResult | null>(null);
  const state =
    result?.requestKey === requestKey
      ? result
      : ({ status: "loading" } as const);

  useEffect(() => {
    const controller = new AbortController();
    const filters: AuditFilters = {
      page,
      pageSize: 25,
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {})
    };
    void listAuditLogs(filters, controller.signal)
      .then((collection) => {
        if (!controller.signal.aborted) {
          setResult({ status: "success", collection, requestKey });
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
          setResult({ status: "forbidden", requestKey });
          return;
        }
        setResult({
          status: "error",
          message:
            error instanceof ApiError && error.status === 422
              ? error.message
              : "Unable to load audit logs.",
          requestKey
        });
      });
    return () => controller.abort();
  }, [entityId, entityType, invalidateSession, page, requestKey]);

  function buildSearch(nextPage: number): URLSearchParams {
    const nextSearchParams = new URLSearchParams();
    nextSearchParams.set("page", String(nextPage));
    if (entityType) {
      nextSearchParams.set("entityType", entityType);
    }
    if (entityId) {
      nextSearchParams.set("entityId", entityId);
    }
    return nextSearchParams;
  }

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextEntityType = String(formData.get("entityType") ?? "");
    const nextEntityId = String(formData.get("entityId") ?? "").trim();
    const nextSearchParams = new URLSearchParams();
    nextSearchParams.set("page", "1");
    if (nextEntityType) {
      nextSearchParams.set("entityType", nextEntityType);
    }
    if (nextEntityId) {
      nextSearchParams.set("entityId", nextEntityId);
    }
    setSearchParams(nextSearchParams);
  }

  if (state.status === "forbidden") {
    return (
      <main className="status-page">
        <h1>Access denied</h1>
        <p>Admin permission is required to view audit logs.</p>
        <Link to="/">Return to assigned fields</Link>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <nav className="back-link admin-breadcrumbs" aria-label="Admin navigation">
        <Link to="/">Assigned fields</Link>
        <Link to="/admin/submissions">Admin submissions</Link>
      </nav>
      <header className="page-heading">
        <p className="eyebrow">Admin review</p>
        <h1>Audit logs</h1>
        <p>Review append-only submission audit events and recorded values.</p>
      </header>

      <form
        key={`${entityType}:${entityId}`}
        className="filter-panel"
        onSubmit={applyFilters}
      >
        <div className="filter-grid">
          <div className="form-control">
            <label htmlFor="audit-entity-type">Entity type</label>
            <select
              id="audit-entity-type"
              name="entityType"
              defaultValue={entityType}
            >
              <option value="">All entity types</option>
              <option value="SUBMISSION">Submission</option>
            </select>
          </div>
          <div className="form-control">
            <label htmlFor="audit-entity-id">Entity ID</label>
            <input
              id="audit-entity-id"
              name="entityId"
              defaultValue={entityId}
            />
          </div>
        </div>
        <button type="submit">Apply filters</button>
      </form>

      {state.status === "loading" ? <p role="status">Loading audit logs...</p> : null}

      {state.status === "error" ? (
        <section className="status-panel" aria-labelledby="audit-error-heading">
          <h2 id="audit-error-heading">Unable to load audit logs</h2>
          <p>{state.message}</p>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)}>
            Try again
          </button>
        </section>
      ) : null}

      {state.status === "success" ? (
        <section className="history-section" aria-labelledby="audit-results-heading">
          <h2 id="audit-results-heading">Audit results</h2>
          <AuditHistoryTable
            caption="Audit logs"
            rows={state.collection.data}
            emptyMessage="No audit logs match these filters."
          />
          <PaginationControl
            label="Audit log pages"
            meta={state.collection.meta}
            onPageChange={(nextPage) => setSearchParams(buildSearch(nextPage))}
          />
        </section>
      ) : null}
    </main>
  );
}
