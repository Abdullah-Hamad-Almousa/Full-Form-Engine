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
  assignAuthTestUserToField,
  AUTH_TEST_PASSWORD,
  AUTH_TEST_PREFIX,
  createAuthTestUser,
  createMostDataSubmissionFixture,
  SUBMISSION_TEST_KEY_PREFIX
} from "../src/test/fixtures.js";

const HISTORY_KEY_PREFIX = `${SUBMISSION_TEST_KEY_PREFIX}history_`;
const HISTORY_USER_PREFIX = `${AUTH_TEST_PREFIX}${HISTORY_KEY_PREFIX}`;
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

type HistoryFixture = Awaited<ReturnType<typeof createMostDataSubmissionFixture>>;

async function authenticatedAgent(user: { username: string }) {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .send({ username: user.username, password: AUTH_TEST_PASSWORD })
    .expect(200);
  return agent;
}

async function createHistoryUser(
  fixture: HistoryFixture,
  key: string,
  role: Role,
  managerId?: string
) {
  const user = await createAuthTestUser({
    key: `${HISTORY_KEY_PREFIX}${key}`,
    role
  });
  if (managerId) {
    await prisma.user.update({ where: { id: user.id }, data: { managerId } });
  }
  return user;
}

async function createStoredSubmission({
  fixture,
  userId,
  id,
  createdAt = new Date("2026-08-25T08:31:00.000Z")
}: {
  fixture: HistoryFixture;
  userId: string;
  id: string;
  createdAt?: Date;
}) {
  return prisma.submission.create({
    data: {
      id,
      fieldModuleId: fixture.fieldModule.id,
      formVersionId: fixture.formVersion.id,
      userId,
      workDate: new Date("2026-08-25T00:00:00.000Z"),
      responseData: RESPONSE_DATA,
      confirmedByUserId: userId,
      confirmedAt: new Date("2026-08-25T08:31:00.000Z"),
      confirmationTextVersion: 1,
      createdAt,
      updatedAt: createdAt
    }
  });
}

async function cleanupHistoryData(): Promise<void> {
  requireSafeTestDatabase();
  await cleanupTestFieldModuleBySlug("most-data");
  await cleanupTestUsersByPrefix(HISTORY_USER_PREFIX);
}

beforeEach(async () => {
  await cleanupHistoryData();
});

afterAll(async () => {
  await cleanupHistoryData();
  await closeSessionStore();
  await prisma.$disconnect();
});

describe("self submission history API", () => {
  it("requires a current assignment but not canSubmit and returns only active own rows", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "history_self",
      canSubmit: false
    });
    await createStoredSubmission({
      fixture,
      userId: fixture.user.id,
      id: "phase5-history-self"
    });
    const otherWorker = await createHistoryUser(
      fixture,
      "self_other",
      Role.WORKER
    );
    await createStoredSubmission({
      fixture,
      userId: otherWorker.id,
      id: "phase5-history-other"
    });
    const agent = await authenticatedAgent(fixture.user);

    const response = await agent.get(
      "/api/fields/most-data/submissions/me?page=1&pageSize=25"
    );

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ page: 1, pageSize: 25, total: 1 });
    expect(response.body.data).toEqual([
      {
        id: "phase5-history-self",
        field: { slug: "most-data", name: "Most Data" },
        formVersion: { id: fixture.formVersion.id, versionNumber: 1 },
        submittedBy: {
          id: fixture.user.id,
          name: fixture.user.name,
          username: fixture.user.username
        },
        workDate: "2026-08-25",
        workTime: "08:30",
        location: { value: "building-a", label: "Building A" },
        shift: { value: "morning", label: "Morning" },
        heat: {
          value: 42.5,
          unit: { value: "CELSIUS", label: "°C - Celsius" }
        },
        status: { value: "NORMAL", label: "Normal" },
        confirmedBy: {
          id: fixture.user.id,
          name: fixture.user.name,
          username: fixture.user.username
        },
        confirmedAt: "2026-08-25T08:31:00.000Z",
        confirmationTextVersion: 1,
        createdAt: "2026-08-25T08:31:00.000Z",
        updatedAt: "2026-08-25T08:31:00.000Z",
        recordState: "ACTIVE"
      }
    ]);
    expect(response.body.data[0]).not.toHaveProperty("deletedAt");
  });

  it("uses createdAt then id descending and returns correct empty-page metadata", async () => {
    const fixture = await createMostDataSubmissionFixture({ key: "history_order" });
    for (const id of ["phase5-history-a", "phase5-history-c", "phase5-history-b"]) {
      await createStoredSubmission({ fixture, userId: fixture.user.id, id });
    }
    const agent = await authenticatedAgent(fixture.user);

    const firstPage = await agent.get(
      "/api/fields/most-data/submissions/me?page=1&pageSize=2"
    );
    const emptyPage = await agent.get(
      "/api/fields/most-data/submissions/me?page=3&pageSize=2"
    );

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.map(({ id }: { id: string }) => id)).toEqual([
      "phase5-history-c",
      "phase5-history-b"
    ]);
    expect(firstPage.body.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
    expect(emptyPage.body).toEqual({
      data: [],
      meta: { page: 3, pageSize: 2, total: 3 }
    });
  });

  it("rejects unknown, invalid, and reversed queries with the standard envelope", async () => {
    const fixture = await createMostDataSubmissionFixture({ key: "history_query" });
    const agent = await authenticatedAgent(fixture.user);
    for (const query of [
      "pageSize=101",
      "from=2026-02-30",
      "from=2026-08-26&to=2026-08-25",
      "workerId=another-worker"
    ]) {
      const response = await agent.get(
        `/api/fields/most-data/submissions/me?${query}`
      );
      expect(response.status).toBe(422);
      expect(response.body.error).toMatchObject({
        code: "VALIDATION_FAILED",
        requestId: response.headers["x-request-id"]
      });
    }
  });
});

describe("Manager team submission history API", () => {
  it("requires MANAGER plus assignment and includes only current direct-report Workers", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "history_manager_base"
    });
    const manager = await createHistoryUser(
      fixture,
      "manager",
      Role.MANAGER
    );
    await assignAuthTestUserToField({
      userId: manager.id,
      fieldModuleId: fixture.fieldModule.id,
      canSubmit: false
    });
    const directWorker = await createHistoryUser(
      fixture,
      "direct_worker",
      Role.WORKER,
      manager.id
    );
    const inactiveDirectWorker = await createHistoryUser(
      fixture,
      "inactive_direct_worker",
      Role.WORKER,
      manager.id
    );
    const directManager = await createHistoryUser(
      fixture,
      "direct_manager",
      Role.MANAGER,
      manager.id
    );
    const outsideWorker = await createHistoryUser(
      fixture,
      "outside_worker",
      Role.WORKER
    );
    await prisma.user.update({
      where: { id: inactiveDirectWorker.id },
      data: { active: false }
    });
    for (const [id, userId] of [
      ["phase5-team-worker", directWorker.id],
      ["phase5-team-inactive", inactiveDirectWorker.id],
      ["phase5-team-manager", directManager.id],
      ["phase5-team-outside", outsideWorker.id],
      ["phase5-team-self", manager.id]
    ] as const) {
      await createStoredSubmission({ fixture, userId, id });
    }
    const agent = await authenticatedAgent(manager);

    const response = await agent.get(
      "/api/manager/fields/most-data/submissions"
    );

    expect(response.status).toBe(200);
    expect(response.body.data.map(({ id }: { id: string }) => id).sort()).toEqual([
      "phase5-team-inactive",
      "phase5-team-worker"
    ]);
    expect(response.body.meta.total).toBe(2);
  });

  it("rejects non-Managers, unassigned Managers, and an outside-team workerId", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "history_manager_denied"
    });
    const workerAgent = await authenticatedAgent(fixture.user);
    const workerResponse = await workerAgent.get(
      "/api/manager/fields/most-data/submissions"
    );
    expect(workerResponse.status).toBe(403);
    expect(workerResponse.body.error.code).toBe("ROLE_FORBIDDEN");

    const manager = await createHistoryUser(
      fixture,
      "unassigned_manager",
      Role.MANAGER
    );
    const outsideWorker = await createHistoryUser(
      fixture,
      "filter_outside",
      Role.WORKER
    );
    const managerAgent = await authenticatedAgent(manager);
    const unassigned = await managerAgent.get(
      "/api/manager/fields/most-data/submissions"
    );
    expect(unassigned.status).toBe(403);
    expect(unassigned.body.error.code).toBe("FIELD_ACCESS_FORBIDDEN");

    await assignAuthTestUserToField({
      userId: manager.id,
      fieldModuleId: fixture.fieldModule.id
    });
    const outsideFilter = await managerAgent.get(
      `/api/manager/fields/most-data/submissions?workerId=${outsideWorker.id}`
    );
    expect(outsideFilter.status).toBe(422);
    expect(outsideFilter.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      fields: { workerId: expect.any(String) }
    });
  });
});
