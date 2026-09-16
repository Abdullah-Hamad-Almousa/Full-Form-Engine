import type { PaginationMeta } from "../services/submission-history";

type PaginationControlProps = {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  label?: string;
};

export function PaginationControl({
  meta,
  onPageChange,
  label = "Pagination"
}: PaginationControlProps) {
  const pageCount = Math.max(1, Math.ceil(meta.total / meta.pageSize));
  const firstResult = (meta.page - 1) * meta.pageSize + 1;
  const lastResult = Math.min(meta.page * meta.pageSize, meta.total);
  const hasResultsOnPage = meta.total > 0 && firstResult <= meta.total;

  return (
    <nav className="pagination" aria-label={label}>
      <p>
        <strong>
          Page {meta.page} of {pageCount}
        </strong>
        <span>
          {hasResultsOnPage
            ? `Showing ${firstResult}–${lastResult} of ${meta.total}`
            : meta.total === 0
              ? "No results"
              : "No results on this page"}
        </span>
      </p>
      <div className="pagination__actions">
        <button
          type="button"
          onClick={() => onPageChange(meta.page - 1)}
          disabled={meta.page <= 1}
          aria-label="Previous page"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(meta.page + 1)}
          disabled={meta.page >= pageCount}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
