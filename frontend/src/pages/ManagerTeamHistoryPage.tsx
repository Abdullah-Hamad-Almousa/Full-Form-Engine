import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { PaginationControl } from "../components/PaginationControl";
import { SubmissionHistoryTable } from "../components/SubmissionHistoryTable";
import { ApiError } from "../services/api";
import {
  listManagerSubmissions,
  type ManagerSubmissionFilters
} from "../services/manager";
import type { SubmissionHistoryCollection } from "../services/submission-history";

type TeamHistoryResult =
  | {
      status: "success";
      collection: SubmissionHistoryCollection;
      requestKey: string;
    }
  | { status: "forbidden"; requestKey: string }
  | { status: "not-found"; requestKey: string }
  | { status: "error"; message: string; requestKey: string };

function parsePage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) {
    return 1;
  }
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function ManagerTeamHistoryPage() {
  const { fieldSlug = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { invalidateSession } = useAuth();
  const page = parsePage(searchParams.get("page"));
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const workerId = searchParams.get("workerId") ?? "";
  const [filterError, setFilterError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${fieldSlug}:${page}:${from}:${to}:${workerId}:${retryKey}`;
  const [result, setResult] = useState<TeamHistoryResult | null>(null);
  const state =
    result?.requestKey === requestKey
      ? result
      : ({ status: "loading" } as const);

  useEffect(() => {
    const controller = new AbortController();
    const filters: ManagerSubmissionFilters = {
      page,
      pageSize: 25,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(workerId ? { workerId } : {})
    };
    void listManagerSubmissions(fieldSlug, filters, controller.signal)
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
        if (error instanceof ApiError && error.status === 404) {
          setResult({ status: "not-found", requestKey });
          return;
        }
        setResult({
          status: "error",
          message:
            error instanceof ApiError && error.status === 422
              ? error.message
              : "Unable to load team submission history.",
          requestKey
        });
      });
    return () => controller.abort();
  }, [fieldSlug, from, invalidateSession, page, requestKey, to, workerId]);

  function createSearch(nextPage: number): URLSearchParams {
    const nextSearchParams = new URLSearchParams();
    nextSearchParams.set("page", String(nextPage));
    if (from) {
      nextSearchParams.set("from", from);
    }
    if (to) {
      nextSearchParams.set("to", to);
    }
    if (workerId) {
      nextSearchParams.set("workerId", workerId);
    }
    return nextSearchParams;
  }

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextFrom = String(formData.get("from") ?? "");
    const nextTo = String(formData.get("to") ?? "");
    const nextWorkerId = String(formData.get("workerId") ?? "").trim();
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
    if (nextWorkerId) {
      nextSearchParams.set("workerId", nextWorkerId);
    }
    setSearchParams(nextSearchParams);
  }

  if (state.status === "forbidden") {
    return (
      <main className="status-page">
        <h1>Access denied</h1>
        <p>You need a current Manager assignment to this field.</p>
        <Link to="/">Return to assigned fields</Link>
      </main>
    );
  }

  if (state.status === "not-found") {
    return (
      <main className="status-page">
        <h1>Field not found</h1>
        <p>The requested field is unavailable.</p>
        <Link to="/">Return to assigned fields</Link>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Link className="back-link" to="/">Back to assigned fields</Link>
      <header className="page-heading">
        <p className="eyebrow">Manager view</p>
        <h1>Team submission history</h1>
        <p>Current direct-report Worker submissions are shown for this assigned field.</p>
      </header>

      <form
        key={`${from}:${to}:${workerId}`}
        className="filter-panel"
        onSubmit={applyFilters}
        noValidate
      >
        <div className="filter-grid">
          <div className="form-control">
            <label htmlFor="manager-worker-id">Worker ID</label>
            <input
              id="manager-worker-id"
              name="workerId"
              defaultValue={workerId}
            />
          </div>
          <div className="form-control">
            <label htmlFor="manager-history-from">From date</label>
            <input
              id="manager-history-from"
              name="from"
              type="date"
              defaultValue={from}
            />
          </div>
          <div className="form-control">
            <label htmlFor="manager-history-to">To date</label>
            <input
              id="manager-history-to"
              name="to"
              type="date"
              defaultValue={to}
            />
          </div>
        </div>
        {filterError ? <p className="field-error" role="alert">{filterError}</p> : null}
        <button type="submit">Apply filters</button>
      </form>

      {state.status === "loading" ? (
        <p role="status">Loading team submission history...</p>
      ) : null}

      {state.status === "error" ? (
        <section className="status-panel" aria-labelledby="team-error-heading">
          <h2 id="team-error-heading">Unable to load team history</h2>
          <p>{state.message}</p>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)}>
            Try again
          </button>
        </section>
      ) : null}

      {state.status === "success" ? (
        <section className="history-section" aria-labelledby="team-results-heading">
          <h2 id="team-results-heading">Team history results</h2>
          <SubmissionHistoryTable
            caption="Manager team submission history"
            rows={state.collection.data}
            emptyMessage="No team submissions match these filters."
          />
          <PaginationControl
            label="Manager team history pages"
            meta={state.collection.meta}
            onPageChange={(nextPage) => setSearchParams(createSearch(nextPage))}
          />
        </section>
      ) : null}
    </main>
  );
}
