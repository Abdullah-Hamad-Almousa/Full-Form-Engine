ALTER TABLE "submissions" ADD COLUMN "deleted_at" TIMESTAMP(3);

ALTER TABLE "audit_logs" RENAME COLUMN "admin_user_id" TO "actor_user_id";
ALTER TABLE "audit_logs" RENAME CONSTRAINT "audit_logs_admin_user_id_fkey" TO "audit_logs_actor_user_id_fkey";
ALTER INDEX "audit_logs_admin_user_id_idx" RENAME TO "audit_actor_user_idx";
ALTER TABLE "audit_logs" ADD COLUMN "actor_role" "Role";
UPDATE "audit_logs" SET "actor_role" = 'ADMIN';
ALTER TABLE "audit_logs" ALTER COLUMN "actor_role" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "reason" DROP NOT NULL;
ALTER TABLE "audit_logs" ADD COLUMN "request_id" TEXT;
DROP INDEX "audit_logs_entity_type_entity_id_idx";
DROP INDEX "audit_logs_created_at_idx";

CREATE INDEX "sub_self_order_idx" ON "submissions"("user_id", "field_module_id", "deleted_at", "created_at" DESC, "id" DESC);
CREATE INDEX "sub_field_order_idx" ON "submissions"("field_module_id", "deleted_at", "created_at" DESC, "id" DESC);
CREATE INDEX "sub_admin_order_idx" ON "submissions"("deleted_at", "created_at" DESC, "id" DESC);
CREATE INDEX "audit_entity_order_idx" ON "audit_logs"("entity_type", "entity_id", "created_at" DESC, "id" DESC);
CREATE INDEX "audit_order_idx" ON "audit_logs"("created_at" DESC, "id" DESC);
