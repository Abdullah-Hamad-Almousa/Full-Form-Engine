import { z } from "zod";

import { api } from "./api";

const nonEmptyStringSchema = z.string().trim().min(1);

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

export const workDateSchema = z.string().refine(isCalendarDate);
export const timestampSchema = z.string().refine(isCanonicalTimestamp);

const namedUserSchema = z
  .object({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    username: nonEmptyStringSchema
  })
  .strict();

const fieldReferenceSchema = z
  .object({
    slug: nonEmptyStringSchema,
    name: nonEmptyStringSchema
  })
  .strict();

const formVersionReferenceSchema = z
  .object({
    id: nonEmptyStringSchema,
    versionNumber: z.number().int().positive()
  })
  .strict();

const optionValueSchema = z
  .object({
    value: nonEmptyStringSchema,
    label: nonEmptyStringSchema
  })
  .strict();

export const submissionHistoryRowSchema = z
  .object({
    id: nonEmptyStringSchema,
    field: fieldReferenceSchema,
    formVersion: formVersionReferenceSchema,
    submittedBy: namedUserSchema,
    workDate: workDateSchema,
    workTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    location: optionValueSchema,
    shift: optionValueSchema,
    heat: z
      .object({
        value: z.number().finite(),
        unit: optionValueSchema
      })
      .strict(),
    status: optionValueSchema,
    confirmedBy: namedUserSchema,
    confirmedAt: timestampSchema,
    confirmationTextVersion: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    recordState: z.literal("ACTIVE")
  })
  .strict();

export const paginationMetaSchema = z
  .object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(100),
    total: z.number().int().nonnegative()
  })
  .strict();

export const submissionHistoryCollectionSchema = z
  .object({
    data: z.array(submissionHistoryRowSchema),
    meta: paginationMetaSchema
  })
  .strict();

export type SubmissionHistoryRow = z.infer<typeof submissionHistoryRowSchema>;
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;
export type SubmissionHistoryCollection = z.infer<
  typeof submissionHistoryCollectionSchema
>;

export type HistoryFilters = {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
};

export function appendHistoryFilters(
  searchParams: URLSearchParams,
  filters: HistoryFilters
): void {
  if (filters.page !== undefined) {
    searchParams.set("page", String(filters.page));
  }
  if (filters.pageSize !== undefined) {
    searchParams.set("pageSize", String(filters.pageSize));
  }
  if (filters.from) {
    searchParams.set("from", filters.from);
  }
  if (filters.to) {
    searchParams.set("to", filters.to);
  }
}

export function withSearchParams(
  path: string,
  searchParams: URLSearchParams
): string {
  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export async function listSelfSubmissions(
  fieldSlug: string,
  filters: HistoryFilters = {},
  signal?: AbortSignal
): Promise<SubmissionHistoryCollection> {
  const searchParams = new URLSearchParams();
  appendHistoryFilters(searchParams, filters);
  const response = await api<unknown>(
    withSearchParams(
      `/api/fields/${encodeURIComponent(fieldSlug)}/submissions/me`,
      searchParams
    ),
    { signal, expectedStatus: 200 }
  );
  return submissionHistoryCollectionSchema.parse(response);
}
