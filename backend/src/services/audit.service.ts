import { Prisma, type Role } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import type { AuditLogQuery } from "../validation/history.schema.js";
import type { PublicUserIdentity } from "./submission-history.service.js";

export const SUBMISSION_AUDIT_ENTITY_TYPE = "SUBMISSION";
export const SUBMISSION_AUDIT_ACTIONS = {
  created: "SUBMISSION_CREATED",
  corrected: "SUBMISSION_CORRECTED",
  deleted: "SUBMISSION_DELETED",
  restored: "SUBMISSION_RESTORED"
} as const;

export type SubmissionAuditAction =
  (typeof SUBMISSION_AUDIT_ACTIONS)[keyof typeof SUBMISSION_AUDIT_ACTIONS];

type JsonSnapshotValue =
  | null
  | boolean
  | number
  | string
  | JsonSnapshotValue[]
  | { [field: string]: JsonSnapshotValue };

export const submissionAuditSourceSelect = {
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
  deletedAt: true
} satisfies Prisma.SubmissionSelect;

export type SubmissionSnapshotSource = {
  id: string;
  fieldModuleId: string;
  formVersionId: string;
  userId: string;
  workDate: Date;
  responseData: Prisma.JsonValue;
  confirmedByUserId: string;
  confirmedAt: Date;
  confirmationTextVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type SubmissionAuditSnapshot = {
  id: string;
  fieldModuleId: string;
  formVersionId: string;
  userId: string;
  workDate: string;
  responseData: JsonSnapshotValue;
  confirmedByUserId: string;
  confirmedAt: string;
  confirmationTextVersion: number;
  createdAt: string;
  updatedAt: string;
  recordState: "ACTIVE" | "DELETED";
  deletedAt: string | null;
};

export type PublicAuditLogRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  field: {
    id: string;
    slug: string;
    name: string;
  } | null;
  actor: PublicUserIdentity;
  actorRole: Role;
  reason: string | null;
  oldValue: Prisma.JsonValue | null;
  newValue: Prisma.JsonValue | null;
  createdAt: string;
  requestId: string | null;
};

function cloneJsonValue(value: Prisma.JsonValue): JsonSnapshotValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Submission audit snapshot contains invalid JSON.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  const cloned: { [field: string]: JsonSnapshotValue } = {};
  for (const [field, fieldValue] of Object.entries(value)) {
    if (fieldValue === undefined) {
      throw new Error("Submission audit snapshot contains invalid JSON.");
    }
    cloned[field] = cloneJsonValue(fieldValue);
  }
  return cloned;
}

function serializeDateOnly(value: Date): string {
  const year = value.getUTCFullYear().toString().padStart(4, "0");
  const month = (value.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = value.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function serializeSubmissionAuditSnapshot(
  submission: SubmissionSnapshotSource
): SubmissionAuditSnapshot {
  return {
    id: submission.id,
    fieldModuleId: submission.fieldModuleId,
    formVersionId: submission.formVersionId,
    userId: submission.userId,
    workDate: serializeDateOnly(submission.workDate),
    responseData: cloneJsonValue(submission.responseData),
    confirmedByUserId: submission.confirmedByUserId,
    confirmedAt: submission.confirmedAt.toISOString(),
    confirmationTextVersion: submission.confirmationTextVersion,
    createdAt: submission.createdAt.toISOString(),
    updatedAt: submission.updatedAt.toISOString(),
    recordState: submission.deletedAt === null ? "ACTIVE" : "DELETED",
    deletedAt: submission.deletedAt?.toISOString() ?? null
  };
}

export async function appendSubmissionAudit({
  transaction,
  action,
  actor,
  fieldModuleId,
  submissionId,
  reason,
  oldSnapshot,
  newSnapshot,
  requestId
}: {
  transaction: Prisma.TransactionClient;
  action: SubmissionAuditAction;
  actor: { id: string; role: Role };
  fieldModuleId: string;
  submissionId: string;
  reason: string | null;
  oldSnapshot: SubmissionAuditSnapshot | null;
  newSnapshot: SubmissionAuditSnapshot;
  requestId: string | null;
}): Promise<{ id: string }> {
  return transaction.auditLog.create({
    data: {
      actorUserId: actor.id,
      actorRole: actor.role,
      action,
      entityType: SUBMISSION_AUDIT_ENTITY_TYPE,
      entityId: submissionId,
      fieldModuleId,
      oldValue:
        oldSnapshot === null
          ? Prisma.DbNull
          : (oldSnapshot as Prisma.InputJsonValue),
      newValue: newSnapshot as Prisma.InputJsonValue,
      reason,
      requestId
    },
    select: { id: true }
  });
}

function mapAuditLogRow(row: {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorRole: Role;
  reason: string | null;
  oldValue: Prisma.JsonValue | null;
  newValue: Prisma.JsonValue | null;
  createdAt: Date;
  requestId: string | null;
  actorUser: PublicUserIdentity;
  fieldModule: { id: string; slug: string; name: string } | null;
}): PublicAuditLogRow {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    field: row.fieldModule ? { ...row.fieldModule } : null,
    actor: { ...row.actorUser },
    actorRole: row.actorRole,
    reason: row.reason,
    oldValue: row.oldValue,
    newValue: row.newValue,
    createdAt: row.createdAt.toISOString(),
    requestId: row.requestId
  };
}

export async function listAuditLogs(query: AuditLogQuery): Promise<{
  data: PublicAuditLogRow[];
  meta: { page: number; pageSize: number; total: number };
}> {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {})
  };
  const total = await prisma.auditLog.count({ where });
  const offset = (query.page - 1) * query.pageSize;
  const rows =
    offset > 2_147_483_647
      ? []
      : await prisma.auditLog.findMany({
          where,
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            actorRole: true,
            reason: true,
            oldValue: true,
            newValue: true,
            createdAt: true,
            requestId: true,
            actorUser: {
              select: { id: true, name: true, username: true }
            },
            fieldModule: {
              select: { id: true, slug: true, name: true }
            }
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: offset,
          take: query.pageSize
        });
  return {
    data: rows.map(mapAuditLogRow),
    meta: { page: query.page, pageSize: query.pageSize, total }
  };
}
