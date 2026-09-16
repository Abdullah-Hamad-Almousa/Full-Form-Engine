import { Role } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../middleware/authenticate.js";
import { ApplicationError } from "../middleware/error-handler.js";
import { requireFieldAccess } from "../middleware/require-field-access.js";
import { requireRole } from "../middleware/require-role.js";
import { listManagerSubmissionHistory } from "../services/submission-history.service.js";
import { parseManagerHistoryQuery } from "../validation/history.schema.js";

export const managerRouter = Router();

managerRouter.use(authenticate);
managerRouter.use(requireRole(Role.MANAGER));

managerRouter.get(
  "/fields/:fieldSlug/submissions",
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
    const query = parseManagerHistoryQuery(request.query);
    response.json(
      await listManagerSubmissionHistory({
        managerId: currentUser.id,
        fieldModuleId: fieldAccess.fieldModuleId,
        query
      })
    );
  }
);
