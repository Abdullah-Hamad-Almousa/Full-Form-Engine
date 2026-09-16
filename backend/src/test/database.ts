import { prisma } from "../lib/prisma.js";
import { assertSafeTestDatabaseUrl } from "./setup.js";

export type StoredSessionRow = {
  sid: string;
  sess: unknown;
  expire: Date;
};

export function requireSafeTestDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests.");
  }

  assertSafeTestDatabaseUrl(databaseUrl);
}

export async function sessionTableExists(): Promise<boolean> {
  requireSafeTestDatabase();
  const [result] = await prisma.$queryRaw<Array<{ tableName: string | null }>>`
    SELECT to_regclass('public.session')::text AS "tableName"
  `;
  return result?.tableName === "session";
}

export async function findSessionsForUser(
  userId: string
): Promise<StoredSessionRow[]> {
  requireSafeTestDatabase();
  if (!(await sessionTableExists())) {
    return [];
  }

  return prisma.$queryRaw<StoredSessionRow[]>`
    SELECT "sid", "sess", "expire"
    FROM "session"
    WHERE "sess"->>'userId' = ${userId}
    ORDER BY "expire" ASC
  `;
}

export async function expireSessionsForUser(userId: string): Promise<void> {
  requireSafeTestDatabase();
  if (!(await sessionTableExists())) {
    return;
  }

  await prisma.$executeRaw`
    UPDATE "session"
    SET "expire" = CURRENT_TIMESTAMP - INTERVAL '1 hour'
    WHERE "sess"->>'userId' = ${userId}
  `;
}

export async function deleteSessionsForUserIds(
  userIds: readonly string[]
): Promise<void> {
  requireSafeTestDatabase();
  if (userIds.length === 0 || !(await sessionTableExists())) {
    return;
  }

  for (const userId of userIds) {
    await prisma.$executeRaw`
      DELETE FROM "session"
      WHERE "sess"->>'userId' = ${userId}
    `;
  }
}

export async function cleanupTestUsersByPrefix(prefix: string): Promise<void> {
  requireSafeTestDatabase();
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map(({ id }) => id);
  const submissions = await prisma.submission.findMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { confirmedByUserId: { in: userIds } }
      ]
    },
    select: { id: true }
  });
  const submissionIds = submissions.map(({ id }) => id);

  await deleteSessionsForUserIds(userIds);
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        {
          entityType: "SUBMISSION",
          entityId: { in: submissionIds }
        }
      ]
    }
  });
  await prisma.submission.deleteMany({
    where: { id: { in: submissionIds } }
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: prefix } }
  });
}

export async function cleanupTestFieldModulesBySlugPrefix(
  prefix: string
): Promise<void> {
  requireSafeTestDatabase();
  const fieldModules = await prisma.fieldModule.findMany({
    where: { slug: { startsWith: prefix } },
    select: { id: true }
  });
  const fieldModuleIds = fieldModules.map(({ id }) => id);
  const submissions = await prisma.submission.findMany({
    where: { fieldModuleId: { in: fieldModuleIds } },
    select: { id: true }
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { fieldModuleId: { in: fieldModuleIds } },
        {
          entityType: "SUBMISSION",
          entityId: { in: submissions.map(({ id }) => id) }
        }
      ]
    }
  });
  await prisma.submission.deleteMany({
    where: { fieldModuleId: { in: fieldModuleIds } }
  });
  await prisma.formVersion.deleteMany({
    where: {
      fieldModuleId: { in: fieldModules.map(({ id }) => id) }
    }
  });
  await prisma.fieldModule.deleteMany({
    where: { slug: { startsWith: prefix } }
  });
}

export async function cleanupTestFieldModuleBySlug(
  slug: string
): Promise<void> {
  requireSafeTestDatabase();
  const fieldModule = await prisma.fieldModule.findUnique({
    where: { slug },
    select: { id: true }
  });
  if (fieldModule) {
    const submissions = await prisma.submission.findMany({
      where: { fieldModuleId: fieldModule.id },
      select: { id: true }
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { fieldModuleId: fieldModule.id },
          {
            entityType: "SUBMISSION",
            entityId: { in: submissions.map(({ id }) => id) }
          }
        ]
      }
    });
    await prisma.submission.deleteMany({
      where: { fieldModuleId: fieldModule.id }
    });
    await prisma.formVersion.deleteMany({
      where: { fieldModuleId: fieldModule.id }
    });
  }
  await prisma.fieldModule.deleteMany({ where: { slug } });
}
