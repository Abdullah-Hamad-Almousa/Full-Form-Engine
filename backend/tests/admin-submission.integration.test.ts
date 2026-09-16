import { Role } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { closeSessionStore } from "../src/middleware/session.js";
import {
  cleanupTestFieldModuleBySlug,
  cleanupTestUsersByPrefix,
  requireSafeTestDatabase
} from "../src/test/database.js";
import {
  AUTH_TEST_PASSWORD,
  AUTH_TEST_PREFIX,
  createAuthTestUser,
  createMostDataSubmissionFixture,
  SUBMISSION_TEST_KEY_PREFIX
} from "../src/test/fixtures.js";

const ADMIN_KEY_PREFIX = `${SUBMISSION_TEST_KEY_PREFIX}admin_history_`;
const ADMIN_USER_PREFIX = `${AUTH_TEST_PREFIX}${ADMIN_KEY_PREFIX}`;
const RESPONSE_DATA = {
  workDate: "2026-08-25",
  workTime: "08:30",
  locationId: "building-a",
  shiftId: "morning",
  heatValue: 42.5,
  heatUnit: "CELSIUS",
  status: "NORMAL",
  issueDetected: false
};

type AdminFixture = Awaited<ReturnType<typeof createMostDataSubmissionFixture>>;

async function authenticatedAgent(user: { username: string }) {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .send({ username: user.username, password: AUTH_TEST_PASSWORD })
    .expect(200);
  return agent;
}

async function createAdmin(key: string) {
  return createAuthTestUser({
    key: `${ADMIN_KEY_PREFIX}admin_${key}`,
    role: Role.ADMIN
  });
}

async function createStoredSubmission(fixture: AdminFixture, id: string) {
  const timestamp = new Date("2026-08-25T08:31:00.000Z");
  return prisma.submission.create({
    data: {
      id,
      fieldModuleId: fixture.fieldModule.id,
      formVersionId: fixture.formVersion.id,
      userId: fixture.user.id,
      workDate: new Date("2026-08-25T00:00:00.000Z"),
      responseData: RESPONSE_DATA,
      confirmedByUserId: fixture.user.id,
      confirmedAt: timestamp,
      confirmationTextVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  });
}

async function cleanupAdminData(): Promise<void> {
  requireSafeTestDatabase();
  await cleanupTestFieldModuleBySlug("most-data");
  await cleanupTestUsersByPrefix(ADMIN_USER_PREFIX);
}

beforeEach(async () => {
  await cleanupAdminData();
});

afterAll(async () => {
  await cleanupAdminData();
  await closeSessionStore();
  await prisma.$disconnect();
});

describe("Admin submission reads", () => {
  it("requires ADMIN but no field assignment and returns strict list and historical detail DTOs", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "admin_history_reads"
    });
    await createStoredSubmission(fixture, "phase5-admin-read");
    const workerAgent = await authenticatedAgent(fixture.user);
    const denied = await workerAgent.get("/api/admin/submissions");
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("ROLE_FORBIDDEN");

    const admin = await createAdmin("reads");
    const adminAgent = await authenticatedAgent(admin);
    const list = await adminAgent.get(
      `/api/admin/submissions?fieldSlug=most-data&userId=${fixture.user.id}&state=ACTIVE`
    );

    expect(list.status).toBe(200);
    expect(list.body.meta).toEqual({ page: 1, pageSize: 25, total: 1 });
    expect(list.body.data[0]).toMatchObject({
      id: "phase5-admin-read",
      field: { slug: "most-data", name: "Most Data" },
      submittedBy: {
        id: fixture.user.id,
        name: fixture.user.name,
        username: fixture.user.username
      },
      heat: {
        value: 42.5,
        unit: { value: "CELSIUS", label: "°C - Celsius" }
      },
      recordState: "ACTIVE",
      deletedAt: null
    });

    const detail = await adminAgent.get(
      "/api/admin/submissions/phase5-admin-read"
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.responseData).toEqual(RESPONSE_DATA);
    expect(detail.body.data.historicalForm).toEqual({
      formVersionId: fixture.formVersion.id,
      versionNumber: 1,
      fields: expect.any(Array),
      rules: [
        {
          kind: "ALL_OR_NONE",
          fieldKeys: ["quantityValue", "quantityUnit"]
        }
      ]
    });
    expect(detail.body.data.historicalForm.fields).toHaveLength(11);
    expect(Object.keys(detail.body.data).sort()).toEqual(
      [
        ...Object.keys(list.body.data[0]),
        "responseData",
        "historicalForm"
      ].sort()
    );
  });

  it("rejects invalid Admin filters and returns non-disclosing missing detail", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "admin_history_filters"
    });
    const admin = await createAdmin("filters");
    const agent = await authenticatedAgent(admin);
    for (const query of [
      "state=active",
      "pageSize=101",
      "from=2026-09-01&to=2026-08-01",
      "workerId=not-approved"
    ]) {
      const response = await agent.get(`/api/admin/submissions?${query}`);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    }
    const missing = await agent.get("/api/admin/submissions/missing-id");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatchObject({
      code: "SUBMISSION_NOT_FOUND",
      requestId: missing.headers["x-request-id"]
    });
    expect(fixture.assignment).not.toBeNull();
  });
});

describe("Admin submission mutation and audit API", () => {
  it("corrects, soft-deletes, restores, and exposes complete stable audit rows", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "admin_history_mutations"
    });
    await createStoredSubmission(fixture, "phase5-admin-mutate");
    const admin = await createAdmin("mutations");
    const adminAgent = await authenticatedAgent(admin);
    const before = await adminAgent.get(
      "/api/admin/submissions/phase5-admin-mutate"
    );
    const immutable = {
      id: before.body.data.id,
      formVersion: before.body.data.formVersion,
      submittedBy: before.body.data.submittedBy,
      confirmedBy: before.body.data.confirmedBy,
      confirmedAt: before.body.data.confirmedAt,
      confirmationTextVersion: before.body.data.confirmationTextVersion,
      createdAt: before.body.data.createdAt
    };
    const correctedResponseData = {
      ...RESPONSE_DATA,
      workDate: "2026-08-26",
      heatValue: 43,
      notes: "  Corrected value.  "
    };

    const corrected = await adminAgent
      .patch("/api/admin/submissions/phase5-admin-mutate")
      .send({
        expectedUpdatedAt: before.body.data.updatedAt,
        reason: "  Corrected against source sheet.  ",
        responseData: correctedResponseData
      });

    expect(corrected.status).toBe(200);
    expect(corrected.body.data).toMatchObject({
      ...immutable,
      workDate: "2026-08-26",
      responseData: {
        ...correctedResponseData,
        notes: "Corrected value."
      },
      recordState: "ACTIVE",
      deletedAt: null
    });
    expect(corrected.body.data.updatedAt).not.toBe(before.body.data.updatedAt);

    const noChange = await adminAgent
      .patch("/api/admin/submissions/phase5-admin-mutate")
      .send({
        expectedUpdatedAt: corrected.body.data.updatedAt,
        reason: "No actual change",
        responseData: corrected.body.data.responseData
      });
    expect(noChange.status).toBe(422);
    expect(noChange.body.error.code).toBe("CORRECTION_NO_CHANGE");

    const staleDelete = await adminAgent
      .delete("/api/admin/submissions/phase5-admin-mutate")
      .send({
        expectedUpdatedAt: before.body.data.updatedAt,
        reason: "Stale duplicate decision"
      });
    expect(staleDelete.status).toBe(409);
    expect(staleDelete.body.error.code).toBe("SUBMISSION_CONFLICT");

    const deleted = await adminAgent
      .delete("/api/admin/submissions/phase5-admin-mutate")
      .send({
        expectedUpdatedAt: corrected.body.data.updatedAt,
        reason: "Duplicate entry confirmed"
      });
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toMatchObject({
      ...immutable,
      recordState: "DELETED",
      deletedAt: expect.any(String)
    });

    const deleteAgain = await adminAgent
      .delete("/api/admin/submissions/phase5-admin-mutate")
      .send({
        expectedUpdatedAt: deleted.body.data.updatedAt,
        reason: "Delete again"
      });
    expect(deleteAgain.status).toBe(409);
    expect(deleteAgain.body.error.code).toBe("SUBMISSION_CONFLICT");

    const workerAgent = await authenticatedAgent(fixture.user);
    const selfHistory = await workerAgent.get(
      "/api/fields/most-data/submissions/me"
    );
    expect(selfHistory.status).toBe(200);
    expect(selfHistory.body.meta.total).toBe(0);
    expect(
      (await adminAgent.get("/api/admin/submissions")).body.meta.total
    ).toBe(0);
    const deletedList = await adminAgent.get(
      "/api/admin/submissions?state=DELETED"
    );
    expect(deletedList.body.data).toHaveLength(1);

    const restored = await adminAgent
      .post("/api/admin/submissions/phase5-admin-mutate/restorations")
      .send({
        expectedUpdatedAt: deleted.body.data.updatedAt,
        reason: "Restored after duplicate review"
      });
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({
      ...immutable,
      recordState: "ACTIVE",
      deletedAt: null
    });

    const restoreAgain = await adminAgent
      .post("/api/admin/submissions/phase5-admin-mutate/restorations")
      .send({
        expectedUpdatedAt: restored.body.data.updatedAt,
        reason: "Restore again"
      });
    expect(restoreAgain.status).toBe(409);
    expect(restoreAgain.body.error.code).toBe("SUBMISSION_CONFLICT");

    const auditResponse = await adminAgent.get(
      "/api/admin/audit-logs?entityType=SUBMISSION&entityId=phase5-admin-mutate"
    );
    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.meta).toEqual({ page: 1, pageSize: 25, total: 3 });
    expect(
      auditResponse.body.data.map(({ action }: { action: string }) => action)
    ).toEqual([
      "SUBMISSION_RESTORED",
      "SUBMISSION_DELETED",
      "SUBMISSION_CORRECTED"
    ]);
    expect(auditResponse.body.data[0]).toEqual({
      id: expect.any(String),
      action: "SUBMISSION_RESTORED",
      entityType: "SUBMISSION",
      entityId: "phase5-admin-mutate",
      field: {
        id: fixture.fieldModule.id,
        slug: "most-data",
        name: "Most Data"
      },
      actor: { id: admin.id, name: admin.name, username: admin.username },
      actorRole: "ADMIN",
      reason: "Restored after duplicate review",
      oldValue: expect.objectContaining({
        id: "phase5-admin-mutate",
        recordState: "DELETED",
        deletedAt: expect.any(String)
      }),
      newValue: expect.objectContaining({
        id: "phase5-admin-mutate",
        recordState: "ACTIVE",
        deletedAt: null
      }),
      createdAt: expect.any(String),
      requestId: expect.any(String)
    });
    expect(Object.keys(auditResponse.body.data[0].oldValue).sort()).toEqual(
      [
        "id",
        "fieldModuleId",
        "formVersionId",
        "userId",
        "workDate",
        "responseData",
        "confirmedByUserId",
        "confirmedAt",
        "confirmationTextVersion",
        "createdAt",
        "updatedAt",
        "recordState",
        "deletedAt"
      ].sort()
    );
  });

  it("creates one atomic durable creation audit with the database actor role", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "admin_history_creation_audit"
    });
    const workerAgent = await authenticatedAgent(fixture.user);
    const creation = await workerAgent
      .post("/api/fields/most-data/submissions")
      .send({
        formVersionId: fixture.formVersion.id,
        confirmed: true,
        responseData: RESPONSE_DATA
      });
    expect(creation.status).toBe(201);

    const admin = await createAdmin("creation_audit");
    const adminAgent = await authenticatedAgent(admin);
    const audits = await adminAgent.get(
      `/api/admin/audit-logs?entityType=SUBMISSION&entityId=${creation.body.data.id}`
    );

    expect(audits.status).toBe(200);
    expect(audits.body.meta.total).toBe(1);
    expect(audits.body.data[0]).toMatchObject({
      action: "SUBMISSION_CREATED",
      entityType: "SUBMISSION",
      entityId: creation.body.data.id,
      actor: {
        id: fixture.user.id,
        name: fixture.user.name,
        username: fixture.user.username
      },
      actorRole: "WORKER",
      reason: null,
      oldValue: null,
      newValue: {
        id: creation.body.data.id,
        fieldModuleId: fixture.fieldModule.id,
        formVersionId: fixture.formVersion.id,
        userId: fixture.user.id,
        workDate: "2026-08-25",
        responseData: RESPONSE_DATA,
        confirmedByUserId: fixture.user.id,
        confirmedAt: expect.any(String),
        confirmationTextVersion: 1,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        recordState: "ACTIVE",
        deletedAt: null
      },
      requestId: creation.headers["x-request-id"]
    });
  });

  it("does not expose mutation or audit reads to Workers and Managers", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "admin_history_permissions"
    });
    await createStoredSubmission(fixture, "phase5-admin-permission");
    for (const role of [Role.WORKER, Role.MANAGER]) {
      const actor =
        role === Role.WORKER
          ? fixture.user
          : await createAuthTestUser({
              key: `${ADMIN_KEY_PREFIX}permission_manager`,
              role
            });
      const agent = await authenticatedAgent(actor);
      for (const response of [
        await agent.get("/api/admin/submissions"),
        await agent.get("/api/admin/submissions/phase5-admin-permission"),
        await agent.patch("/api/admin/submissions/phase5-admin-permission").send({}),
        await agent.delete("/api/admin/submissions/phase5-admin-permission").send({}),
        await agent
          .post("/api/admin/submissions/phase5-admin-permission/restorations")
          .send({}),
        await agent.get("/api/admin/audit-logs")
      ]) {
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe("ROLE_FORBIDDEN");
      }
    }
  });
});
