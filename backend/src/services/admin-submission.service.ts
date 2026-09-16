import { Prisma, Role } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { ApplicationError } from "../middleware/error-handler.js";
import type {
  AdminCorrectionBody,
  AdminStateChangeBody
} from "../validation/admin-submission.schema.js";
import { validateAndCanonicalizeResponseData } from "../validation/submission.schema.js";
import {
  appendSubmissionAudit,
  serializeSubmissionAuditSnapshot,
  SUBMISSION_AUDIT_ACTIONS
} from "./audit.service.js";
import {
  mapAdminSubmissionDetail,
  submissionHistorySelect,
  submissionNotFound,
  type PublicAdminSubmissionDetail,
  type StoredHistorySubmission
} from "./submission-history.service.js";

function submissionConflict(): ApplicationError {
  return new ApplicationError({
    status: 409,
    code: "SUBMISSION_CONFLICT",
    message:
      "The submission changed before this action was completed. Reload it and try again."
  });
}

function correctionNoChange(): ApplicationError {
  return new ApplicationError({
    status: 422,
    code: "CORRECTION_NO_CHANGE",
    message: "Change at least one submitted value before saving a correction."
  });
}

function isTransactionConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2003" ||
      error.code === "P2025" ||
      error.code === "P2034")
  );
}

function canonicalResponsesEqual(
  left: Record<string, string | number | boolean>,
  right: Record<string, string | number | boolean>
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (fieldKey, index) =>
        fieldKey === rightKeys[index] && Object.is(left[fieldKey], right[fieldKey])
    )
  );
}

function nextUpdateTimestamp(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

async function requireAdminActor(
  transaction: Prisma.TransactionClient,
  actorId: string
): Promise<{ id: string; role: Role }> {
  const actor = await transaction.user.findUnique({
    where: { id: actorId },
    select: { id: true, role: true, active: true }
  });
  if (!actor?.active || actor.role !== Role.ADMIN) {
    throw submissionConflict();
  }
  return { id: actor.id, role: actor.role };
}

async function findSubmissionForMutation(
  transaction: Prisma.TransactionClient,
  submissionId: string
): Promise<StoredHistorySubmission> {
  const submission = await transaction.submission.findUnique({
    where: { id: submissionId },
    select: submissionHistorySelect
  });
  if (!submission) {
    throw submissionNotFound();
  }
  return submission;
}

function requireExpectedState(
  submission: StoredHistorySubmission,
  expectedUpdatedAt: string,
  expectedState: "ACTIVE" | "DELETED"
): void {
  if (
    submission.updatedAt.toISOString() !== expectedUpdatedAt ||
    (expectedState === "ACTIVE"
      ? submission.deletedAt !== null
      : submission.deletedAt === null)
  ) {
    throw submissionConflict();
  }
}

export async function correctAdminSubmission({
  actorId,
  submissionId,
  requestId,
  input
}: {
  actorId: string;
  submissionId: string;
  requestId: string;
  input: AdminCorrectionBody;
}): Promise<PublicAdminSubmissionDetail> {
  try {
    return await prisma.$transaction(
      async (transaction) => {
        const actor = await requireAdminActor(transaction, actorId);
        const current = await findSubmissionForMutation(
          transaction,
          submissionId
        );
        requireExpectedState(current, input.expectedUpdatedAt, "ACTIVE");
        const currentDetail = mapAdminSubmissionDetail(current);
        const validated = validateAndCanonicalizeResponseData(
          currentDetail.historicalForm,
          input.responseData
        );
        if (
          canonicalResponsesEqual(
            currentDetail.responseData,
            validated.responseData
          )
        ) {
          throw correctionNoChange();
        }

        const updatedAt = nextUpdateTimestamp(current.updatedAt);
        const result = await transaction.submission.updateMany({
          where: {
            id: submissionId,
            updatedAt: current.updatedAt,
            deletedAt: null
          },
          data: {
            workDate: validated.workDate,
            responseData: validated.responseData,
            updatedAt
          }
        });
        if (result.count !== 1) {
          throw submissionConflict();
        }
        const updated = await findSubmissionForMutation(
          transaction,
          submissionId
        );
        await appendSubmissionAudit({
          transaction,
          action: SUBMISSION_AUDIT_ACTIONS.corrected,
          actor,
          fieldModuleId: current.fieldModuleId,
          submissionId,
          reason: input.reason,
          oldSnapshot: serializeSubmissionAuditSnapshot(current),
          newSnapshot: serializeSubmissionAuditSnapshot(updated),
          requestId
        });
        return mapAdminSubmissionDetail(updated);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (isTransactionConflict(error)) {
      throw submissionConflict();
    }
    throw error;
  }
}

async function transitionSubmissionState({
  actorId,
  submissionId,
  requestId,
  input,
  transition
}: {
  actorId: string;
  submissionId: string;
  requestId: string;
  input: AdminStateChangeBody;
  transition: "DELETE" | "RESTORE";
}): Promise<PublicAdminSubmissionDetail> {
  try {
    return await prisma.$transaction(
      async (transaction) => {
        const actor = await requireAdminActor(transaction, actorId);
        const current = await findSubmissionForMutation(
          transaction,
          submissionId
        );
        const expectedState = transition === "DELETE" ? "ACTIVE" : "DELETED";
        requireExpectedState(current, input.expectedUpdatedAt, expectedState);
        const updatedAt = nextUpdateTimestamp(current.updatedAt);
        const deletedAt = transition === "DELETE" ? updatedAt : null;
        const result = await transaction.submission.updateMany({
          where: {
            id: submissionId,
            updatedAt: current.updatedAt,
            ...(transition === "DELETE"
              ? { deletedAt: null }
              : { deletedAt: { not: null } })
          },
          data: { deletedAt, updatedAt }
        });
        if (result.count !== 1) {
          throw submissionConflict();
        }
        const updated = await findSubmissionForMutation(
          transaction,
          submissionId
        );
        await appendSubmissionAudit({
          transaction,
          action:
            transition === "DELETE"
              ? SUBMISSION_AUDIT_ACTIONS.deleted
              : SUBMISSION_AUDIT_ACTIONS.restored,
          actor,
          fieldModuleId: current.fieldModuleId,
          submissionId,
          reason: input.reason,
          oldSnapshot: serializeSubmissionAuditSnapshot(current),
          newSnapshot: serializeSubmissionAuditSnapshot(updated),
          requestId
        });
        return mapAdminSubmissionDetail(updated);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (isTransactionConflict(error)) {
      throw submissionConflict();
    }
    throw error;
  }
}

export function deleteAdminSubmission(input: {
  actorId: string;
  submissionId: string;
  requestId: string;
  input: AdminStateChangeBody;
}): Promise<PublicAdminSubmissionDetail> {
  return transitionSubmissionState({ ...input, transition: "DELETE" });
}

export function restoreAdminSubmission(input: {
  actorId: string;
  submissionId: string;
  requestId: string;
  input: AdminStateChangeBody;
}): Promise<PublicAdminSubmissionDetail> {
  return transitionSubmissionState({ ...input, transition: "RESTORE" });
}
