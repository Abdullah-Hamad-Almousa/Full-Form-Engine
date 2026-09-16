import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "../services/api";
import {
  listSelfSubmissions,
  type SubmissionHistoryRow
} from "../services/submission-history";
import { SubmissionHistoryTable } from "./SubmissionHistoryTable";

type RecentResult =
  | { status: "success"; rows: SubmissionHistoryRow[]; requestKey: string }
  | { status: "error"; message: string; requestKey: string };

type RecentSubmissionsProps = {
  fieldSlug: string;
  refreshKey?: number;
  onSessionExpired: () => void;
};

export function RecentSubmissions({
  fieldSlug,
  refreshKey = 0,
  onSessionExpired
}: RecentSubmissionsProps) {
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${fieldSlug}:${refreshKey}:${retryKey}`;
  const [result, setResult] = useState<RecentResult | null>(null);
  const state =
    result?.requestKey === requestKey
      ? result
      : ({ status: "loading" } as const);

  useEffect(() => {
    const controller = new AbortController();
    void listSelfSubmissions(
      fieldSlug,
      { page: 1, pageSize: 5 },
      controller.signal
    )
      .then((collection) => {
        if (!controller.signal.aborted) {
          setResult({ status: "success", rows: collection.data, requestKey });
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
          onSessionExpired();
          return;
        }
        setResult({
          status: "error",
          message:
            error instanceof ApiError && error.status === 403
              ? "You no longer have permission to view recent submissions."
              : "Unable to load recent submissions.",
          requestKey
        });
      });
    return () => controller.abort();
  }, [fieldSlug, onSessionExpired, requestKey]);

  return (
    <section className="history-section" aria-labelledby="recent-submissions-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Saved records</p>
          <h2 id="recent-submissions-heading">Recent submissions</h2>
        </div>
        <Link to={`/fields/${encodeURIComponent(fieldSlug)}/history`}>
          View full history
        </Link>
      </div>

      {state.status === "loading" ? (
        <p role="status">Loading recent submissions...</p>
      ) : null}

      {state.status === "error" ? (
        <div className="inline-status inline-status--error" role="alert">
          <p>{state.message}</p>
          <button
            type="button"
            onClick={() => setRetryKey((current) => current + 1)}
          >
            Retry recent submissions
          </button>
        </div>
      ) : null}

      {state.status === "success" ? (
        <SubmissionHistoryTable
          caption="Recent submissions"
          rows={state.rows}
          emptyMessage="No recent submissions yet."
        />
      ) : null}
    </section>
  );
}
