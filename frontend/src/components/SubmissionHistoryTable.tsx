import { Link } from "react-router-dom";

import type { AdminSubmissionRow } from "../services/admin";
import type { SubmissionHistoryRow } from "../services/submission-history";

const workDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC"
});

const measurementFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 20
});

type DisplaySubmissionRow = SubmissionHistoryRow | AdminSubmissionRow;

type SubmissionHistoryTableProps = {
  caption: string;
  rows: readonly DisplaySubmissionRow[];
  emptyMessage?: string;
  showRecordState?: boolean;
  getRecordHref?: (row: DisplaySubmissionRow) => string;
};

function formatWorkDate(workDate: string): string {
  return workDateFormatter.format(new Date(`${workDate}T00:00:00.000Z`));
}

function isAdminRow(row: DisplaySubmissionRow): row is AdminSubmissionRow {
  return "deletedAt" in row;
}

export function SubmissionHistoryTable({
  caption,
  rows,
  emptyMessage = "No submissions are available.",
  showRecordState = false,
  getRecordHref
}: SubmissionHistoryTableProps) {
  if (rows.length === 0) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <div className="table-scroll" tabIndex={0}>
      <table className="history-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Time</th>
            <th scope="col">Worker</th>
            <th scope="col">Location</th>
            <th scope="col">Shift</th>
            <th scope="col">Heat</th>
            <th scope="col">Status</th>
            <th scope="col">Confirmed</th>
            {showRecordState ? <th scope="col">Record state</th> : null}
            {getRecordHref ? <th scope="col">Record</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{formatWorkDate(row.workDate)}</td>
              <td>{row.workTime}</td>
              <td>
                <span>{row.submittedBy.name}</span>
                <span className="table-secondary">{row.submittedBy.username}</span>
              </td>
              <td>{row.location.label}</td>
              <td>{row.shift.label}</td>
              <td>
                {measurementFormatter.format(row.heat.value)} {row.heat.unit.label}
              </td>
              <td>{row.status.label}</td>
              <td>Yes</td>
              {showRecordState ? (
                <td>
                  {isAdminRow(row) && row.recordState === "DELETED"
                    ? "Deleted"
                    : "Active"}
                </td>
              ) : null}
              {getRecordHref ? (
                <td>
                  <Link to={getRecordHref(row)}>Review submission</Link>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
