import connectPgSimple from "connect-pg-simple";
import session, { type CookieOptions } from "express-session";
import type { Request, Response } from "express";

import { env } from "../config/env.js";

const PgSession = connectPgSimple(session);
const sessionTtlSeconds = env.SESSION_TTL_HOURS * 60 * 60;

export type SessionCookieConfiguration = {
  secure: boolean;
  ttlHours: number;
  sameSite: "strict" | "lax" | "none";
};

export function createSessionCookieOptions({
  secure,
  ttlHours,
  sameSite
}: SessionCookieConfiguration): CookieOptions {
  return {
    httpOnly: true,
    sameSite,
    secure,
    path: "/",
    maxAge: ttlHours * 60 * 60 * 1000
  };
}

const sessionCookieOptions = createSessionCookieOptions({
  secure: env.SESSION_COOKIE_SECURE,
  ttlHours: env.SESSION_TTL_HOURS,
  sameSite: env.SESSION_COOKIE_SAMESITE
});

export const sessionStore = new PgSession({
  conString: env.DATABASE_URL,
  createTableIfMissing: true,
  ttl: sessionTtlSeconds,
  errorLog: (error: unknown) => {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "session_store_error",
        errorName: error instanceof Error ? error.name : "UnknownError"
      })
    );
  }
});

export const sessionMiddleware = session({
  name: env.SESSION_COOKIE_NAME,
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: sessionCookieOptions
});

export function destroySession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(env.SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: env.SESSION_COOKIE_SAMESITE,
    secure: env.SESSION_COOKIE_SECURE,
    path: "/"
  });
}

export async function closeSessionStore(): Promise<void> {
  await sessionStore.close();
}
