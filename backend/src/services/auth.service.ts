import type { Role } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { verifyPassword } from "./password.service.js";

const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$FuqiinGF/Sqg6lDr8R4g3A$YihkFpAV6iPiAW5w4f+MwTGp5PxqevRYBJzYVY3X9+c";

const authenticatedUserSelect = {
  id: true,
  name: true,
  username: true,
  email: true,
  role: true,
  active: true
} as const;

export type AuthenticatedUser = {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: Role;
};

export type AuthenticationFailureReason =
  | "user_not_found"
  | "incorrect_password"
  | "inactive_account";

export type AuthenticationResult =
  | { authenticated: true; user: AuthenticatedUser }
  | {
      authenticated: false;
      reason: AuthenticationFailureReason;
      userId?: string;
    };

function mapAuthenticatedUser(user: AuthenticatedUser): AuthenticatedUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role
  };
}

export async function authenticateCredentials(
  username: string,
  password: string
): Promise<AuthenticationResult> {
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      ...authenticatedUserSelect,
      passwordHash: true
    }
  });

  if (!user) {
    await verifyPassword(DUMMY_PASSWORD_HASH, password);
    return { authenticated: false, reason: "user_not_found" };
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    return {
      authenticated: false,
      reason: "incorrect_password",
      userId: user.id
    };
  }

  if (!user.active) {
    return {
      authenticated: false,
      reason: "inactive_account",
      userId: user.id
    };
  }

  return {
    authenticated: true,
    user: mapAuthenticatedUser(user)
  };
}

export async function findAuthenticatedUserById(
  userId: string
): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: authenticatedUserSelect
  });

  if (!user?.active) {
    return null;
  }

  return mapAuthenticatedUser(user);
}
