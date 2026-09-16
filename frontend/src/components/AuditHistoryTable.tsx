import type { AuditRow } from "../services/admin";

const timestampFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC"
});

type AuditHistoryTableProps = {
  caption: string;
  rows: readonly AuditRow[];
  emptyMessage?: string;
};

function formatJson(value: AuditRow["oldValue"]): string {
  return value === null ? "null" : JSON.stringify(value, null, 2);
}

export function AuditHistoryTable({
  caption,
  rows,
  emptyMessage = "No audit records are available."
}: AuditHistoryTableProps) {
  if (rows.length === 0) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <div className="table-scroll" tabIndex={0}>
      <table className="history-table audit-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Created</th>
            <th scope="col">Action</th>
            <th scope="col">Entity</th>
            <th scope="col">Field</th>
            <th scope="col">Actor</th>
            <th scope="col">Actor role</th>
            <th scope="col">Reason</th>
            <th scope="col">Request</th>
            <th scope="col">Recorded values</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{timestampFormatter.format(new Date(row.createdAt))}</td>
              <td>{row.action}</td>
              <td>
                <span>{row.entityType}</span>
                <span className="table-secondary">{row.entityId}</span>
              </td>
              <td>{row.field ? row.field.name : "Not associated with a field"}</td>
              <td>
                <span>{row.actor.name}</span>
                <span className="table-secondary">{row.actor.username}</span>
              </td>
              <td>{row.actorRole}</td>
              <td>{row.reason ?? "No reason recorded"}</td>
              <td>{row.requestId ?? "No request ID"}</td>
              <td>
                <details>
                  <summary>View recorded values</summary>
                  <div className="audit-values">
                    <strong>Before</strong>
                    <pre>{formatJson(row.oldValue)}</pre>
                    <strong>After</strong>
                    <pre>{formatJson(row.newValue)}</pre>
                  </div>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
