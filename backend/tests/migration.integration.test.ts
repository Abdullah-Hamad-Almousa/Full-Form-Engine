import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../src/lib/prisma.js";
import { requireSafeTestDatabase } from "../src/test/database.js";

const ROLLBACK = new Error("PHASE_5_MIGRATION_TEST_ROLLBACK");

function migrationStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function executeMigration(
  transaction: Prisma.TransactionClient,
  path: string
): Promise<void> {
  const sql = await readFile(path, "utf8");
  for (const statement of migrationStatements(sql)) {
    await transaction.$executeRawUnsafe(statement);
  }
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Phase 5 history-permissions migration", () => {
  it("preserves pre-Phase rows, actor identity, foreign keys, and ADMIN backfill before rolling back", async () => {
    requireSafeTestDatabase();
    const schemaName = `phase5_migration_${randomUUID().replaceAll("-", "")}`;
    const initialMigration = resolve(
      "prisma/migrations/20260824080138_initial_schema/migration.sql"
    );
    const phase5Migration = resolve(
      "prisma/migrations/20260825133500_history_permissions/migration.sql"
    );

    let rejection: unknown;
    try {
      await prisma.$transaction(
        async (transaction) => {
          await transaction.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
          await transaction.$executeRawUnsafe(
            `SET LOCAL search_path TO "${schemaName}"`
          );
          await executeMigration(transaction, initialMigration);
          await transaction.$executeRawUnsafe(`
            INSERT INTO "users" (
              "id", "name", "username", "password_hash", "role", "active", "updated_at"
            ) VALUES
              ('pre-admin', 'Pre Admin', 'pre-admin', 'hash', 'ADMIN', true, '2026-08-25T08:00:00.000Z'),
              ('pre-worker', 'Pre Worker', 'pre-worker', 'hash', 'WORKER', true, '2026-08-25T08:00:00.000Z')
          `);
          await transaction.$executeRawUnsafe(`
            INSERT INTO "field_modules" (
              "id", "name", "slug", "active", "updated_at"
            ) VALUES ('pre-field', 'Most Data', 'most-data', true, '2026-08-25T08:00:00.000Z')
          `);
          await transaction.$executeRawUnsafe(`
            INSERT INTO "form_versions" (
              "id", "field_module_id", "version_number", "status", "published_at", "created_by_id"
            ) VALUES (
              'pre-form', 'pre-field', 1, 'PUBLISHED', '2026-08-25T08:00:00.000Z', 'pre-admin'
            )
          `);
          await transaction.$executeRawUnsafe(`
            INSERT INTO "submissions" (
              "id", "field_module_id", "form_version_id", "user_id", "work_date",
              "response_data", "confirmed_by_user_id", "confirmed_at",
              "confirmation_text_version", "created_at", "updated_at"
            ) VALUES (
              'pre-submission', 'pre-field', 'pre-form', 'pre-worker', '2026-08-25',
              '{"workDate":"2026-08-25"}'::jsonb, 'pre-worker',
              '2026-08-25T08:31:00.000Z', 1,
              '2026-08-25T08:31:00.000Z', '2026-08-25T08:31:00.000Z'
            )
          `);
          await transaction.$executeRawUnsafe(`
            INSERT INTO "audit_logs" (
              "id", "admin_user_id", "action", "entity_type", "entity_id",
              "field_module_id", "old_value", "new_value", "reason", "created_at"
            ) VALUES (
              'pre-audit', 'pre-admin', 'SUBMISSION_CORRECTED', 'SUBMISSION',
              'pre-submission', 'pre-field', null, '{"id":"pre-submission"}'::jsonb,
              'Pre-Phase reason', '2026-08-25T08:32:00.000Z'
            )
          `);

          await executeMigration(transaction, phase5Migration);

          const [submission] = await transaction.$queryRawUnsafe<
            Array<{ id: string; deletedAt: Date | null }>
          >(`SELECT "id", "deleted_at" AS "deletedAt" FROM "submissions"`);
          expect(submission).toEqual({ id: "pre-submission", deletedAt: null });

          const [audit] = await transaction.$queryRawUnsafe<
            Array<{
              id: string;
              actorUserId: string;
              actorRole: string;
              reason: string | null;
              requestId: string | null;
            }>
          >(`
            SELECT
              "id",
              "actor_user_id" AS "actorUserId",
              "actor_role"::text AS "actorRole",
              "reason",
              "request_id" AS "requestId"
            FROM "audit_logs"
          `);
          expect(audit).toEqual({
            id: "pre-audit",
            actorUserId: "pre-admin",
            actorRole: "ADMIN",
            reason: "Pre-Phase reason",
            requestId: null
          });

          const constraints = await transaction.$queryRawUnsafe<
            Array<{ constraintName: string }>
          >(`
            SELECT conname AS "constraintName"
            FROM pg_constraint
            WHERE connamespace = current_schema()::regnamespace
              AND conname = 'audit_logs_actor_user_id_fkey'
          `);
          expect(constraints).toEqual([
            { constraintName: "audit_logs_actor_user_id_fkey" }
          ]);

          const indexes = await transaction.$queryRawUnsafe<
            Array<{ indexName: string }>
          >(`
            SELECT indexname AS "indexName"
            FROM pg_indexes
            WHERE schemaname = current_schema()
              AND indexname IN (
                'audit_actor_user_idx',
                'audit_entity_order_idx',
                'audit_logs_created_at_idx',
                'audit_logs_entity_type_entity_id_idx',
                'audit_order_idx',
                'sub_admin_order_idx',
                'sub_field_order_idx',
                'sub_self_order_idx'
              )
            ORDER BY indexname
          `);
          expect(indexes.map(({ indexName }) => indexName)).toEqual([
            "audit_actor_user_idx",
            "audit_entity_order_idx",
            "audit_order_idx",
            "sub_admin_order_idx",
            "sub_field_order_idx",
            "sub_self_order_idx"
          ]);

          await transaction.$executeRawUnsafe(`
            INSERT INTO "audit_logs" (
              "id", "actor_user_id", "actor_role", "action", "entity_type",
              "entity_id", "field_module_id", "old_value", "new_value",
              "reason", "request_id", "created_at"
            ) VALUES (
              'post-audit', 'pre-worker', 'WORKER', 'SUBMISSION_CREATED',
              'SUBMISSION', 'pre-submission', 'pre-field', null,
              '{"id":"pre-submission"}'::jsonb, null, 'request-id',
              '2026-08-25T08:33:00.000Z'
            )
          `);
          await expect(
            transaction.$queryRawUnsafe<Array<{ total: bigint }>>(
              `SELECT COUNT(*) AS "total" FROM "audit_logs"`
            )
          ).resolves.toEqual([{ total: 2n }]);

          throw ROLLBACK;
        },
        { maxWait: 10_000, timeout: 30_000 }
      );
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBe(ROLLBACK);
    const [schema] = await prisma.$queryRaw<Array<{ schemaName: string | null }>>`
      SELECT to_regnamespace(${schemaName})::text AS "schemaName"
    `;
    expect(schema?.schemaName).toBeNull();
  });
});
