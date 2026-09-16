import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { PaginationControl } from "../components/PaginationControl";
import { SubmissionHistoryTable } from "../components/SubmissionHistoryTable";
import { ApiError } from "../services/api";
import {
  listSelfSubmissions,
  type SubmissionHistoryCollection
} from "../services/submission-history";

type HistoryResult =
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

export function FieldHistoryPage() {
  const { fieldSlug = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { invalidateSession } = useAuth();
  const page = parsePage(searchParams.get("page"));
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const [filterError, setFilterError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${fieldSlug}:${page}:${from}:${to}:${retryKey}`;
  const [result, setResult] = useState<HistoryResult | null>(null);
  const state =
    result?.requestKey === requestKey
      ? result
      : ({ status: "loading" } as const);

  useEffect(() => {
    const controller = new AbortController();
    void listSelfSubmissions(
      fieldSlug,
      {
        page,
        pageSize: 25,
        ...(from ? { from } : {}),
        ...(to ? { to } : {})
      },
      controller.signal
    )
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
              : "Unable to load submission history.",
          requestKey
        });
      });
    return () => controller.abort();
  }, [fieldSlug, from, invalidateSession, page, requestKey, to]);

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextFrom = String(formData.get("from") ?? "");
    const nextTo = String(formData.get("to") ?? "");
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
    setSearchParams(nextSearchParams);
  }

  function changePage(nextPage: number): void {
    const nextSearchParams = new URLSearchParams();
    nextSearchParams.set("page", String(nextPage));
    if (from) {
      nextSearchParams.set("from", from);
    }
    if (to) {
      nextSearchParams.set("to", to);
    }
    setSearchParams(nextSearchParams);
  }

  if (state.status === "forbidden") {
    return (
      <main className="status-page">
        <h1>Access denied</h1>
        <p>You need a current assignment to view this field history.</p>
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
      <Link className="back-link" to={`/fields/${encodeURIComponent(fieldSlug)}`}>
        Back to field
      </Link>
      <header className="page-heading">
        <p className="eyebrow">Saved records</p>
        <h1>Your submission history</h1>
        <p>Only your active submissions for this assigned field are shown.</p>
      </header>

      <form
        key={`${from}:${to}`}
        className="filter-panel"
        onSubmit={applyFilters}
        noValidate
      >
        <div className="filter-grid">
          <div className="form-control">
            <label htmlFor="self-history-from">From date</label>
            <input
              id="self-history-from"
              name="from"
              type="date"
              defaultValue={from}
            />
          </div>
          <div className="form-control">
            <label htmlFor="self-history-to">To date</label>
            <input
              id="self-history-to"
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
        <p role="status">Loading submission history...</p>
      ) : null}

      {state.status === "error" ? (
        <section className="status-panel" aria-labelledby="history-error-heading">
          <h2 id="history-error-heading">Unable to load submission history</h2>
          <p>{state.message}</p>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)}>
            Try again
          </button>
        </section>
      ) : null}

      {state.status === "success" ? (
        <section className="history-section" aria-labelledby="history-results-heading">
          <h2 id="history-results-heading">History results</h2>
          <SubmissionHistoryTable
            caption="Your submission history"
            rows={state.collection.data}
            emptyMessage="No submissions match these filters."
          />
          <PaginationControl
            label="Your submission history pages"
            meta={state.collection.meta}
            onPageChange={changePage}
          />
        </section>
      ) : null}
    </main>
  );
}
