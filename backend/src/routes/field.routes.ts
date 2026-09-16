import { Router } from "express";

import { authenticate } from "../middleware/authenticate.js";
import { ApplicationError } from "../middleware/error-handler.js";
import { requireFieldAccess } from "../middleware/require-field-access.js";
import {
  findActiveFieldDescriptor,
  listAssignedFields
} from "../services/field-catalog.service.js";
import { findPublishedFormConfiguration } from "../services/form-configuration.service.js";
import { listSelfSubmissionHistory } from "../services/submission-history.service.js";
import { createSubmission } from "../services/submission.service.js";
import { parseSelfHistoryQuery } from "../validation/history.schema.js";
import { parseSubmissionEnvelope } from "../validation/submission.schema.js";

export const fieldRouter = Router();

fieldRouter.use(authenticate);

fieldRouter.get("/", async (request, response) => {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new ApplicationError({
      status: 500,
      code: "AUTHENTICATION_CONTEXT_MISSING",
      message: "An unexpected error occurred."
    });
  }

  response.json({ data: await listAssignedFields(currentUser.id) });
});

fieldRouter.get(
  "/:fieldSlug/submissions/me",
  requireFieldAccess(),
  async (request, response) => {
    const currentUser = request.currentUser;
    const fieldAccess = request.fieldAccess;
    if (!currentUser || !fieldAccess) {
      throw new ApplicationError({
        status: 500,
        code: "HISTORY_CONTEXT_MISSING",
        message: "An unexpected error occurred."
      });
    }
    response.json(
      await listSelfSubmissionHistory({
        actorId: currentUser.id,
        fieldModuleId: fieldAccess.fieldModuleId,
        query: parseSelfHistoryQuery(request.query)
      })
    );
  }
);

fieldRouter.post(
  "/:fieldSlug/submissions",
  requireFieldAccess({ requireCanSubmit: true }),
  async (request, response) => {
    const currentUser = request.currentUser;
    const fieldAccess = request.fieldAccess;
    if (!currentUser || !fieldAccess) {
      throw new ApplicationError({
        status: 500,
        code: "SUBMISSION_CONTEXT_MISSING",
        message: "An unexpected error occurred."
      });
    }

    const envelope = parseSubmissionEnvelope(request.body);
    const submission = await createSubmission({
      actorId: currentUser.id,
      fieldModuleId: fieldAccess.fieldModuleId,
      fieldSlug: fieldAccess.fieldSlug,
      requestId: request.requestId,
      envelope
    });

    response.status(201).json({ data: { id: submission.id } });
  }
);

fieldRouter.get(
  "/:fieldSlug/form",
  requireFieldAccess(),
  async (request, response) => {
    const fieldAccess = request.fieldAccess;
    if (!fieldAccess) {
      throw new ApplicationError({
        status: 500,
        code: "AUTHORIZATION_CONTEXT_MISSING",
        message: "An unexpected error occurred."
      });
    }

    const form = await findPublishedFormConfiguration(
      fieldAccess.fieldModuleId,
      fieldAccess.fieldSlug
    );
    if (!form) {
      throw new ApplicationError({
        status: 404,
        code: "FORM_NOT_AVAILABLE",
        message: "A form is not currently available for this field."
      });
    }

    response.json({ data: form });
  }
);

fieldRouter.get(
  "/:fieldSlug",
  requireFieldAccess(),
  async (request, response) => {
    const fieldAccess = request.fieldAccess;
    if (!fieldAccess) {
      throw new ApplicationError({
        status: 500,
        code: "AUTHORIZATION_CONTEXT_MISSING",
        message: "An unexpected error occurred."
      });
    }

    const field = await findActiveFieldDescriptor(
      fieldAccess.fieldModuleId,
      fieldAccess.canSubmit
    );
    if (!field) {
      throw new ApplicationError({
        status: 404,
        code: "FIELD_NOT_FOUND",
        message: "Field not found."
      });
    }

    response.json({ data: field });
  }
);
