import { Router, type Request } from "express";

import {
  authenticateCredentials,
  type AuthenticationFailureReason
} from "../services/auth.service.js";
import { authenticate } from "../middleware/authenticate.js";
import { ApplicationError } from "../middleware/error-handler.js";
import {
  clearSessionCookie,
  destroySession
} from "../middleware/session.js";
import { parseLoginCredentials } from "../validation/auth.schema.js";

function regenerateSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function saveSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function logAuthenticationFailure(
  requestId: string,
  reason: AuthenticationFailureReason,
  userId?: string
): void {
  console.warn(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "warn",
      event: "login_failed",
      requestId,
      outcome: "rejected",
      reason,
      ...(userId ? { userId } : {})
    })
  );
}

function logAuthenticationSuccess(
  event: "login_succeeded" | "logout_succeeded",
  requestId: string,
  userId?: string
): void {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      event,
      requestId,
      outcome: "succeeded",
      ...(userId ? { userId } : {})
    })
  );
}

export const authRouter = Router();

authRouter.post("/login", async (request, response) => {
  const credentials = parseLoginCredentials(request.body);
  const result = await authenticateCredentials(
    credentials.username,
    credentials.password
  );

  if (!result.authenticated) {
    logAuthenticationFailure(request.requestId, result.reason, result.userId);
    throw new ApplicationError({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid username or password."
    });
  }

  await regenerateSession(request);
  request.session.userId = result.user.id;
  await saveSession(request);
  logAuthenticationSuccess("login_succeeded", request.requestId, result.user.id);

  response.json({ data: { user: result.user } });
});

authRouter.post("/logout", async (request, response) => {
  const userId = request.session.userId;
  await destroySession(request);
  clearSessionCookie(response);
  logAuthenticationSuccess("logout_succeeded", request.requestId, userId);
  response.status(204).end();
});

authRouter.get("/me", authenticate, (request, response) => {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new ApplicationError({
      status: 500,
      code: "AUTHENTICATION_CONTEXT_MISSING",
      message: "An unexpected error occurred."
    });
  }

  response.json({ data: { user: currentUser } });
});
