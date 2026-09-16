import { FormStatus, Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { ApplicationError } from "../middleware/error-handler.js";
import {
  appendSubmissionAudit,
  serializeSubmissionAuditSnapshot,
  submissionAuditSourceSelect,
  SUBMISSION_AUDIT_ACTIONS
} from "./audit.service.js";
import {
  FormConfigurationInvariantError,
  formConfigurationSelect,
  mapPublishedFormConfiguration
} from "./form-configuration.service.js";
import {
  type SubmissionEnvelope,
  validateAndCanonicalizeResponseData
} from "../validation/submission.schema.js";

export const CURRENT_CONFIRMATION_TEXT_VERSION = 1;

export type CreateSubmissionInput = {
  actorId: string;
  fieldModuleId: string;
  fieldSlug: string;
  requestId: string;
  envelope: SubmissionEnvelope;
};

export type CreatedSubmission = {
  id: string;
};

function submissionConflict(): ApplicationError {
  return new ApplicationError({
    status: 409,
    code: "SUBMISSION_CONFLICT",
    message:
      "The submission could not be completed because access or form state changed. Reload the form before trying again."
  });
}

function formVersionNotCurrent(): ApplicationError {
  return new ApplicationError({
    status: 409,
    code: "FORM_VERSION_NOT_CURRENT",
    message: "The form has changed. Reload the current form before submitting.",
    fields: {
      formVersionId: "Reload the current published form before submitting."
    }
  });
}

function isTransactionConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2003" || error.code === "P2034")
  );
}

function logSubmissionCreated({
  requestId,
  actorId,
  fieldModuleId,
  formVersionId,
  resourceId
}: {
  requestId: string;
  actorId: string;
  fieldModuleId: string;
  formVersionId: string;
  resourceId: string;
}): void {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      event: "submission_created",
      requestId,
      actorId,
      fieldModuleId,
      formVersionId,
      resourceId,
      outcome: "success"
    })
  );
}

export async function createSubmission({
  actorId,
  fieldModuleId,
  fieldSlug,
  requestId,
  envelope
}: CreateSubmissionInput): Promise<CreatedSubmission> {
  let created: CreatedSubmission;

  try {
    created = await prisma.$transaction(
      async (transaction) => {
        const actor = await transaction.user.findUnique({
          where: { id: actorId },
          select: { id: true, active: true, role: true }
        });
        if (!actor?.active) {
          throw submissionConflict();
        }

        const field = await transaction.fieldModule.findUnique({
          where: { id: fieldModuleId },
          select: { active: true, slug: true }
        });
        if (!field?.active || field.slug !== fieldSlug) {
          throw submissionConflict();
        }

        const assignment = await transaction.userFieldAssignment.findUnique({
          where: {
            userId_fieldModuleId: {
              userId: actorId,
              fieldModuleId
            }
          },
          select: { canSubmit: true }
        });
        if (!assignment?.canSubmit) {
          throw submissionConflict();
        }

        const publishedForms = await transaction.formVersion.findMany({
          where: {
            fieldModuleId,
            status: FormStatus.PUBLISHED
          },
          select: formConfigurationSelect,
          orderBy: [{ versionNumber: "asc" }, { id: "asc" }],
          take: 2
        });

        if (publishedForms.length > 1) {
          throw new FormConfigurationInvariantError();
        }

        const [publishedForm] = publishedForms;
        if (!publishedForm || publishedForm.id !== envelope.formVersionId) {
          throw formVersionNotCurrent();
        }

        const configuration = mapPublishedFormConfiguration(
          fieldSlug,
          publishedForm
        );
        const validated = validateAndCanonicalizeResponseData(
          configuration,
          envelope.responseData
        );
        const confirmedAt = new Date();

        const submission = await transaction.submission.create({
          data: {
            fieldModuleId,
            formVersionId: publishedForm.id,
            userId: actorId,
            workDate: validated.workDate,
            responseData: validated.responseData,
            confirmedByUserId: actorId,
            confirmedAt,
            confirmationTextVersion: CURRENT_CONFIRMATION_TEXT_VERSION
          },
          select: submissionAuditSourceSelect
        });
        await appendSubmissionAudit({
          transaction,
          action: SUBMISSION_AUDIT_ACTIONS.created,
          actor: { id: actor.id, role: actor.role },
          fieldModuleId,
          submissionId: submission.id,
          reason: null,
          oldSnapshot: null,
          newSnapshot: serializeSubmissionAuditSnapshot(submission),
          requestId
        });
        return { id: submission.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (isTransactionConflict(error)) {
      throw submissionConflict();
    }
    throw error;
  }

  logSubmissionCreated({
    requestId,
    actorId,
    fieldModuleId,
    formVersionId: envelope.formVersionId,
    resourceId: created.id
  });
  return created;
}
