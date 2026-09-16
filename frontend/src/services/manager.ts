import {
  appendHistoryFilters,
  submissionHistoryCollectionSchema,
  withSearchParams,
  type HistoryFilters,
  type SubmissionHistoryCollection
} from "./submission-history";
import { api } from "./api";

export type ManagerSubmissionFilters = HistoryFilters & {
  workerId?: string;
};

export async function listManagerSubmissions(
  fieldSlug: string,
  filters: ManagerSubmissionFilters = {},
  signal?: AbortSignal
): Promise<SubmissionHistoryCollection> {
  const searchParams = new URLSearchParams();
  appendHistoryFilters(searchParams, filters);
  if (filters.workerId) {
    searchParams.set("workerId", filters.workerId);
  }
  const response = await api<unknown>(
    withSearchParams(
      `/api/manager/fields/${encodeURIComponent(fieldSlug)}/submissions`,
      searchParams
    ),
    { signal, expectedStatus: 200 }
  );
  return submissionHistoryCollectionSchema.parse(response);
}
