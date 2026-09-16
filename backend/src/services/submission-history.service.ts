import { InputType, Prisma, Role } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { ApplicationError } from "../middleware/error-handler.js";
import type {
  AdminHistoryQuery,
  HistoryPaginationQuery,
  ManagerHistoryQuery,
  SelfHistoryQuery
} from "../validation/history.schema.js";
import type { CanonicalResponseData } from "../validation/submission.schema.js";
import {
  formConfigurationSelect,
  mapPublishedFormConfiguration,
  type PublicFormConfiguration
} from "./form-configuration.service.js";

export const submissionHistorySelect = {
  id: true,
  fieldModuleId: true,
  formVersionId: true,
  userId: true,
  workDate: true,
  responseData: true,
  confirmedByUserId: true,
  confirmedAt: true,
  confirmationTextVersion: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  fieldModule: {
    select: { id: true, slug: true, name: true }
  },
  formVersion: {
    select: formConfigurationSelect
  },
  user: {
    select: { id: true, name: true, username: true }
  },
  confirmedByUser: {
    select: { id: true, name: true, username: true }
  }
} satisfies Prisma.SubmissionSelect;

export type StoredHistorySubmission = Prisma.SubmissionGetPayload<{
  select: typeof submissionHistorySelect;
}>;

export type PublicUserIdentity = {
  id: string;
  name: string;
  username: string;
};

export type PublicOptionValue = {
  value: string;
  label: string;
};

export type PublicSubmissionHistoryRow = {
  id: string;
  field: {
    slug: string;
    name: string;
  };
  formVersion: {
    id: string;
    versionNumber: number;
  };
  submittedBy: PublicUserIdentity;
  workDate: string;
  workTime: string;
  location: PublicOptionValue;
  shift: PublicOptionValue;
  heat: {
    value: number;
    unit: PublicOptionValue;
  };
  status: PublicOptionValue;
  confirmedBy: PublicUserIdentity;
  confirmedAt: string;
  confirmationTextVersion: number;
  createdAt: string;
  updatedAt: string;
  recordState: "ACTIVE";
};

export type PublicAdminSubmissionRow = Omit<
  PublicSubmissionHistoryRow,
  "recordState"
> & {
  recordState: "ACTIVE" | "DELETED";
  deletedAt: string | null;
};

export type PublicAdminSubmissionDetail = PublicAdminSubmissionRow & {
  responseData: CanonicalResponseData;
  historicalForm: PublicFormConfiguration;
};

export type PaginatedResult<T> = {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
  };
};

export class SubmissionHistoryInvariantError extends Error {
  constructor() {
    super("Submission history invariant failed.");
    this.name = "SubmissionHistoryInvariantError";
  }
}

function serializeDateOnly(value: Date): string {
  const year = value.getUTCFullYear().toString().padStart(4, "0");
  const month = (value.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = value.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseCanonicalResponseData(value: Prisma.JsonValue): CanonicalResponseData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SubmissionHistoryInvariantError();
  }
  const responseData: CanonicalResponseData = {};
  for (const [fieldKey, fieldValue] of Object.entries(value)) {
    if (
      typeof fieldValue !== "string" &&
      typeof fieldValue !== "boolean" &&
      (typeof fieldValue !== "number" || !Number.isFinite(fieldValue))
    ) {
      throw new SubmissionHistoryInvariantError();
    }
    responseData[fieldKey] = fieldValue;
  }
  return responseData;
}

function requireString(
  responseData: CanonicalResponseData,
  fieldKey: string
): string {
  const value = responseData[fieldKey];
  if (typeof value !== "string") {
    throw new SubmissionHistoryInvariantError();
  }
  return value;
}

function requireNumber(
  responseData: CanonicalResponseData,
  fieldKey: string
): number {
  const value = responseData[fieldKey];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SubmissionHistoryInvariantError();
  }
  return value;
}

function mapOption(
  configuration: PublicFormConfiguration,
  fieldKey: string,
  value: string
): PublicOptionValue {
  const option = configuration.fields
    .find((field) => field.fieldKey === fieldKey)
    ?.options.find((candidate) => candidate.value === value);
  if (!option) {
    throw new SubmissionHistoryInvariantError();
  }
  return { value, label: option.label };
}

function requireHistoricalFields(
  configuration: PublicFormConfiguration
): void {
  const expectedFields = new Map([
    ["workDate", InputType.DATE],
    ["workTime", InputType.TIME],
    ["locationId", InputType.SELECT],
    ["shiftId", InputType.SELECT],
    ["heatValue", InputType.NUMBER],
    ["heatUnit", InputType.SELECT],
    ["status", InputType.SELECT]
  ]);
  for (const [fieldKey, inputType] of expectedFields) {
    const field = configuration.fields.find(
      (candidate) => candidate.fieldKey === fieldKey
    );
    if (!field || field.inputType !== inputType) {
      throw new SubmissionHistoryInvariantError();
    }
  }
}

function mapHistoryBase(submission: StoredHistorySubmission) {
  const historicalForm = mapPublishedFormConfiguration(
    submission.fieldModule.slug,
    submission.formVersion
  );
  requireHistoricalFields(historicalForm);
  const responseData = parseCanonicalResponseData(submission.responseData);
  const workDate = serializeDateOnly(submission.workDate);
  if (responseData.workDate !== workDate) {
    throw new SubmissionHistoryInvariantError();
  }
  const workTime = requireString(responseData, "workTime");
  const locationValue = requireString(responseData, "locationId");
  const shiftValue = requireString(responseData, "shiftId");
  const heatValue = requireNumber(responseData, "heatValue");
  const heatUnitValue = requireString(responseData, "heatUnit");
  const statusValue = requireString(responseData, "status");

  return {
    row: {
      id: submission.id,
      field: {
        slug: submission.fieldModule.slug,
        name: submission.fieldModule.name
      },
      formVersion: {
        id: submission.formVersion.id,
        versionNumber: submission.formVersion.versionNumber
      },
      submittedBy: { ...submission.user },
      workDate,
      workTime,
      location: mapOption(historicalForm, "locationId", locationValue),
      shift: mapOption(historicalForm, "shiftId", shiftValue),
      heat: {
        value: heatValue,
        unit: mapOption(historicalForm, "heatUnit", heatUnitValue)
      },
      status: mapOption(historicalForm, "status", statusValue),
      confirmedBy: { ...submission.confirmedByUser },
      confirmedAt: submission.confirmedAt.toISOString(),
      confirmationTextVersion: submission.confirmationTextVersion,
      createdAt: submission.createdAt.toISOString(),
      updatedAt: submission.updatedAt.toISOString()
    },
    responseData,
    historicalForm
  };
}

export function mapSubmissionHistoryRow(
  submission: StoredHistorySubmission
): PublicSubmissionHistoryRow {
  if (submission.deletedAt !== null) {
    throw new SubmissionHistoryInvariantError();
  }
  return { ...mapHistoryBase(submission).row, recordState: "ACTIVE" };
}

export function mapAdminSubmissionRow(
  submission: StoredHistorySubmission
): PublicAdminSubmissionRow {
  return {
    ...mapHistoryBase(submission).row,
    recordState: submission.deletedAt === null ? "ACTIVE" : "DELETED",
    deletedAt: submission.deletedAt?.toISOString() ?? null
  };
}

export function mapAdminSubmissionDetail(
  submission: StoredHistorySubmission
): PublicAdminSubmissionDetail {
  const mapped = mapHistoryBase(submission);
  return {
    ...mapped.row,
    recordState: submission.deletedAt === null ? "ACTIVE" : "DELETED",
    deletedAt: submission.deletedAt?.toISOString() ?? null,
    responseData: mapped.responseData,
    historicalForm: mapped.historicalForm
  };
}

function workDateFilter(
  query: HistoryPaginationQuery
): Prisma.DateTimeFilter | undefined {
  if (!query.from && !query.to) {
    return undefined;
  }
  return {
    ...(query.from
      ? { gte: new Date(`${query.from}T00:00:00.000Z`) }
      : {}),
    ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {})
  };
}

async function listSubmissionRows<T>({
  where,
  query,
  mapRow
}: {
  where: Prisma.SubmissionWhereInput;
  query: HistoryPaginationQuery;
  mapRow: (submission: StoredHistorySubmission) => T;
}): Promise<PaginatedResult<T>> {
  const total = await prisma.submission.count({ where });
  const offset = (query.page - 1) * query.pageSize;
  const submissions =
    offset > 2_147_483_647
      ? []
      : await prisma.submission.findMany({
          where,
          select: submissionHistorySelect,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: offset,
          take: query.pageSize
        });
  return {
    data: submissions.map(mapRow),
    meta: { page: query.page, pageSize: query.pageSize, total }
  };
}

export async function listSelfSubmissionHistory({
  actorId,
  fieldModuleId,
  query
}: {
  actorId: string;
  fieldModuleId: string;
  query: SelfHistoryQuery;
}): Promise<PaginatedResult<PublicSubmissionHistoryRow>> {
  return listSubmissionRows({
    where: {
      fieldModuleId,
      userId: actorId,
      deletedAt: null,
      workDate: workDateFilter(query)
    },
    query,
    mapRow: mapSubmissionHistoryRow
  });
}

export async function listManagerSubmissionHistory({
  managerId,
  fieldModuleId,
  query
}: {
  managerId: string;
  fieldModuleId: string;
  query: ManagerHistoryQuery;
}): Promise<PaginatedResult<PublicSubmissionHistoryRow>> {
  if (query.workerId) {
    const scopedWorker = await prisma.user.findFirst({
      where: {
        id: query.workerId,
        managerId,
        role: Role.WORKER
      },
      select: { id: true }
    });
    if (!scopedWorker) {
      throw new ApplicationError({
        status: 422,
        code: "VALIDATION_FAILED",
        message: "Check the requested filters and try again.",
        fields: {
          workerId: "Select a current direct-report Worker."
        }
      });
    }
  }

  return listSubmissionRows({
    where: {
      fieldModuleId,
      deletedAt: null,
      workDate: workDateFilter(query),
      user: {
        is: {
          managerId,
          role: Role.WORKER,
          ...(query.workerId ? { id: query.workerId } : {})
        }
      }
    },
    query,
    mapRow: mapSubmissionHistoryRow
  });
}

export async function listAdminSubmissions(
  query: AdminHistoryQuery
): Promise<PaginatedResult<PublicAdminSubmissionRow>> {
  const deletedAt: Prisma.DateTimeNullableFilter | null | undefined =
    query.state === "ACTIVE"
      ? null
      : query.state === "DELETED"
        ? { not: null }
        : undefined;
  return listSubmissionRows({
    where: {
      ...(query.fieldSlug
        ? { fieldModule: { is: { slug: query.fieldSlug } } }
        : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(deletedAt !== undefined ? { deletedAt } : {}),
      workDate: workDateFilter(query)
    },
    query,
    mapRow: mapAdminSubmissionRow
  });
}

export function submissionNotFound(): ApplicationError {
  return new ApplicationError({
    status: 404,
    code: "SUBMISSION_NOT_FOUND",
    message: "Submission not found."
  });
}

export async function findAdminSubmissionDetail(
  submissionId: string
): Promise<PublicAdminSubmissionDetail> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: submissionHistorySelect
  });
  if (!submission) {
    throw submissionNotFound();
  }
  return mapAdminSubmissionDetail(submission);
}
