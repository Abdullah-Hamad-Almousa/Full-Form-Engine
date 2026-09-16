import type { RequestHandler } from "express";

import { findFieldAccess } from "../services/field-access.service.js";
import { ApplicationError } from "./error-handler.js";

export type RequireFieldAccessOptions = {
  requireCanSubmit?: boolean;
};

export function requireFieldAccess({
  requireCanSubmit = false
}: RequireFieldAccessOptions = {}): RequestHandler {
  return async (request, response, next) => {
    void response;
    const currentUser = request.currentUser;
    if (!currentUser) {
      throw new ApplicationError({
        status: 500,
        code: "AUTHORIZATION_CONTEXT_MISSING",
        message: "An unexpected error occurred."
      });
    }

    const fieldSlug = request.params.fieldSlug;
    if (typeof fieldSlug !== "string") {
      throw new ApplicationError({
        status: 404,
        code: "FIELD_NOT_FOUND",
        message: "Field not found."
      });
    }

    const result = await findFieldAccess(currentUser.id, fieldSlug);
    if (result.status === "field_not_found") {
      throw new ApplicationError({
        status: 404,
        code: "FIELD_NOT_FOUND",
        message: "Field not found."
      });
    }
    if (result.status === "field_access_forbidden") {
      throw new ApplicationError({
        status: 403,
        code: "FIELD_ACCESS_FORBIDDEN",
        message: "You do not have permission to access this field."
      });
    }
    if (requireCanSubmit && !result.fieldAccess.canSubmit) {
      throw new ApplicationError({
        status: 403,
        code: "FIELD_SUBMISSION_FORBIDDEN",
        message: "You do not have permission to submit to this field."
      });
    }

    request.fieldAccess = result.fieldAccess;
    next();
  };
}
