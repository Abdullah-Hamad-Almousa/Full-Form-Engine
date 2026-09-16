import { Role } from "@prisma/client";
import { Router, type Request } from "express";

import { authenticate } from "../middleware/authenticate.js";
import { ApplicationError } from "../middleware/error-handler.js";
import { requireRole } from "../middleware/require-role.js";
import {
  correctAdminSubmission,
  deleteAdminSubmission,
  restoreAdminSubmission
} from "../services/admin-submission.service.js";
import { listAuditLogs } from "../services/audit.service.js";
import type { AuthenticatedUser } from "../services/auth.service.js";
import {
  findAdminSubmissionDetail,
  listAdminSubmissions,
  submissionNotFound
} from "../services/submission-history.service.js";
import {
  parseAdminCorrectionBody,
  parseAdminStateChangeBody
} from "../validation/admin-submission.schema.js";
import {
  parseAdminHistoryQuery,
  parseAuditLogQuery
} from "../validation/history.schema.js";

export const adminRouter = Router();

function requireCurrentAdmin(request: Request): AuthenticatedUser {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new ApplicationError({
      status: 500,
      code: "ADMIN_CONTEXT_MISSING",
      message: "An unexpected error occurred."
    });
  }
  return currentUser;
}

function requireSubmissionId(request: Request): string {
  const submissionId = request.params.submissionId;
  if (
    typeof submissionId !== "string" ||
    submissionId.length < 1 ||
    submissionId.length > 200
  ) {
    throw submissionNotFound();
  }
  return submissionId;
}

adminRouter.use(authenticate);
adminRouter.use(requireRole(Role.ADMIN));

adminRouter.get("/audit-logs", async (request, response) => {
  requireCurrentAdmin(request);
  response.json(await listAuditLogs(parseAuditLogQuery(request.query)));
});

adminRouter.get("/submissions", async (request, response) => {
  requireCurrentAdmin(request);
  response.json(await listAdminSubmissions(parseAdminHistoryQuery(request.query)));
});

adminRouter.get("/submissions/:submissionId", async (request, response) => {
  requireCurrentAdmin(request);
  response.json({
    data: await findAdminSubmissionDetail(requireSubmissionId(request))
  });
});

adminRouter.patch("/submissions/:submissionId", async (request, response) => {
  const currentUser = requireCurrentAdmin(request);
  response.json({
    data: await correctAdminSubmission({
      actorId: currentUser.id,
      submissionId: requireSubmissionId(request),
      requestId: request.requestId,
      input: parseAdminCorrectionBody(request.body)
    })
  });
});

adminRouter.delete("/submissions/:submissionId", async (request, response) => {
  const currentUser = requireCurrentAdmin(request);
  response.json({
    data: await deleteAdminSubmission({
      actorId: currentUser.id,
      submissionId: requireSubmissionId(request),
      requestId: request.requestId,
      input: parseAdminStateChangeBody(request.body)
    })
  });
});

adminRouter.post(
  "/submissions/:submissionId/restorations",
  async (request, response) => {
    const currentUser = requireCurrentAdmin(request);
    response.json({
      data: await restoreAdminSubmission({
        actorId: currentUser.id,
        submissionId: requireSubmissionId(request),
        requestId: request.requestId,
        input: parseAdminStateChangeBody(request.body)
      })
    });
  }
);
