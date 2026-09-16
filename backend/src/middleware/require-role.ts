import type { Role } from "@prisma/client";
import type { RequestHandler } from "express";

import { ApplicationError } from "./error-handler.js";

export function requireRole(
  ...allowedRoles: [Role, ...Role[]]
): RequestHandler {
  return (request, response, next) => {
    void response;
    const currentUser = request.currentUser;
    if (!currentUser) {
      throw new ApplicationError({
        status: 500,
        code: "AUTHORIZATION_CONTEXT_MISSING",
        message: "An unexpected error occurred."
      });
    }

    if (!allowedRoles.includes(currentUser.role)) {
      throw new ApplicationError({
        status: 403,
        code: "ROLE_FORBIDDEN",
        message: "You do not have permission to perform this action."
      });
    }

    next();
  };
}
