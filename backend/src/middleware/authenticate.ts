import type { RequestHandler } from "express";

import { findAuthenticatedUserById } from "../services/auth.service.js";
import { ApplicationError } from "./error-handler.js";
import { clearSessionCookie, destroySession } from "./session.js";

export const authenticate: RequestHandler = async (
  request,
  response,
  next
) => {
  const userId = request.session.userId;
  if (!userId) {
    clearSessionCookie(response);
    throw new ApplicationError({
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "Authentication is required."
    });
  }

  const currentUser = await findAuthenticatedUserById(userId);
  if (!currentUser) {
    await destroySession(request);
    clearSessionCookie(response);
    throw new ApplicationError({
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "Authentication is required."
    });
  }

  request.currentUser = currentUser;
  next();
};
