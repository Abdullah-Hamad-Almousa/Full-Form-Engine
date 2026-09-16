import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { PaginationControl } from "../components/PaginationControl";
import { SubmissionHistoryTable } from "../components/SubmissionHistoryTable";
import {
  listAdminSubmissions,
  type AdminSubmissionCollection,
  type AdminSubmissionFilters
} from "../services/admin";
import { ApiError } from "../services/api";

type AdminListResult =
  | {
      status: "success";
      collection: AdminSubmissionCollection;
      requestKey: string;
    }
  | { status: "forbidden"; requestKey: string }
  | { status: "error"; message: string; requestKey: string };

type RecordStateFilter = "ACTIVE" | "DELETED" | "ALL";

function parsePage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) {
    return 1;
  }
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function parseState(value: string | null): RecordStateFilter {
  return value === "DELETED" || value === "ALL" ? value : "ACTIVE";
}

export function AdminSubmissionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { invalidateSession } = useAuth();
  const page = parsePage(searchParams.get("page"));
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const fieldSlug = searchParams.get("fieldSlug") ?? "";
  const userId = searchParams.get("userId") ?? "";
  const stateFilter = parseState(searchParams.get("state"));
  const [filterError, setFilterError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${page}:${from}:${to}:${fieldSlug}:${userId}:${stateFilter}:${retryKey}`;
  const [result, setResult] = useState<AdminListResult | null>(null);
  const state =
    result?.requestKey === requestKey
      ? result
      : ({ status: "loading" } as const);

  useEffect(() => {
    const controller = new AbortController();
    const filters: AdminSubmissionFilters = {
      page,
      pageSize: 25,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(fieldSlug ? { fieldSlug } : {}),
      ...(userId ? { userId } : {}),
      state: stateFilter
    };
    void listAdminSubmissions(filters, controller.signal)
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
              : "Unable to load submissions.",
          requestKey
        });
      });
    return () => controller.abort();
  }, [fieldSlug, from, invalidateSession, page, requestKey, stateFilter, to, userId]);

  function buildSearch(nextPage: number): URLSearchParams {
    const nextSearchParams = new URLSearchParams();
    nextSearchParams.set("page", String(nextPage));
    if (from) {
      nextSearchParams.set("from", from);
    }
    if (to) {
      nextSearchParams.set("to", to);
    }
    if (fieldSlug) {
      nextSearchParams.set("fieldSlug", fieldSlug);
    }
    if (userId) {
      nextSearchParams.set("userId", userId);
    }
    nextSearchParams.set("state", stateFilter);
    return nextSearchParams;
  }

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextFrom = String(formData.get("from") ?? "");
    const nextTo = String(formData.get("to") ?? "");
    const nextFieldSlug = String(formData.get("fieldSlug") ?? "").trim();
    const nextUserId = String(formData.get("userId") ?? "").trim();
    const nextState = parseState(String(formData.get("state") ?? "ACTIVE"));
    if (nextFrom && nextTo && nextFrom > nextTo) {
      setFilterError("From date must be on or before To date.");
      return;
    }
    setFilterError(null);
    const nextSearchParams = new URLSearchParams();
    nextSearchParams.set("page", "1");
    if (nextFrom) {
      nextSearchParams.set("from", nextFrom);
    }
    if (nextTo) {
      nextSearchParams.set("to", nextTo);
    }
    if (nextFieldSlug) {
      nextSearchParams.set("fieldSlug", nextFieldSlug);
    }
    if (nextUserId) {
      nextSearchParams.set("userId", nextUserId);
    }
    nextSearchParams.set("state", nextState);
    setSearchParams(nextSearchParams);
  }

  if (state.status === "forbidden") {
    return (
      <main className="status-page">
        <h1>Access denied</h1>
        <p>Admin permission is required to review submissions.</p>
        <Link to="/">Return to assigned fields</Link>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <nav className="back-link admin-breadcrumbs" aria-label="Admin navigation">
        <Link to="/">Assigned fields</Link>
        <Link to="/admin/audit-logs">Audit logs</Link>
      </nav>
      <header className="page-heading">
        <p className="eyebrow">Admin review</p>
        <h1>Admin submissions</h1>
        <p>Review active, deleted, or all submission records.</p>
      </header>

      <form
        key={`${from}:${to}:${fieldSlug}:${userId}:${stateFilter}`}
        className="filter-panel"
        onSubmit={applyFilters}
        noValidate
      >
        <div className="filter-grid">
          <div className="form-control">
            <label htmlFor="admin-field-slug">Field slug</label>
            <input
              id="admin-field-slug"
              name="fieldSlug"
              defaultValue={fieldSlug}
            />
          </div>
          <div className="form-control">
            <label htmlFor="admin-user-id">User ID</label>
            <input
              id="admin-user-id"
              name="userId"
              defaultValue={userId}
            />
          </div>
          <div className="form-control">
            <label htmlFor="admin-state">Record state</label>
            <select
              id="admin-state"
              name="state"
              defaultValue={stateFilter}
            >
              <option value="ACTIVE">Active</option>
              <option value="DELETED">Deleted</option>
              <option value="ALL">All</option>
            </select>
          </div>
          <div className="form-control">
            <label htmlFor="admin-history-from">From date</label>
            <input
              id="admin-history-from"
              name="from"
              type="date"
              defaultValue={from}
            />
          </div>
          <div className="form-control">
            <label htmlFor="admin-history-to">To date</label>
            <input
              id="admin-history-to"
              name="to"
              type="date"
              defaultValue={to}
            />
          </div>
        </div>
        {filterError ? <p className="field-error" role="alert">{filterError}</p> : null}
        <button type="submit">Apply filters</button>
      </form>

      {state.status === "loading" ? <p role="status">Loading submissions...</p> : null}

      {state.status === "error" ? (
        <section className="status-panel" aria-labelledby="admin-list-error-heading">
          <h2 id="admin-list-error-heading">Unable to load submissions</h2>
          <p>{state.message}</p>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)}>
            Try again
          </button>
        </section>
      ) : null}

      {state.status === "success" ? (
        <section className="history-section" aria-labelledby="admin-list-results-heading">
          <h2 id="admin-list-results-heading">Submission results</h2>
          <SubmissionHistoryTable
            caption="Admin submission results"
            rows={state.collection.data}
            emptyMessage="No submissions match these filters."
            showRecordState
            getRecordHref={(row) =>
              `/admin/submissions/${encodeURIComponent(row.id)}`
            }
          />
          <PaginationControl
            label="Admin submission pages"
            meta={state.collection.meta}
            onPageChange={(nextPage) => setSearchParams(buildSearch(nextPage))}
          />
        </section>
      ) : null}
    </main>
  );
}
