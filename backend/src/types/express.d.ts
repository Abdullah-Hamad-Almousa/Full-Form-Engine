import "express-session";

import type { AuthenticatedUser } from "../services/auth.service.js";
import type { FieldAccessContext } from "../services/field-access.service.js";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      currentUser?: AuthenticatedUser;
      fieldAccess?: FieldAccessContext;
      requestId: string;
    }
  }
}

export {};
