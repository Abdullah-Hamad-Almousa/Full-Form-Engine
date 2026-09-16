import { Role } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { closeSessionStore } from "../src/middleware/session.js";
import {
  cleanupTestFieldModuleBySlug,
  cleanupTestFieldModulesBySlugPrefix,
  cleanupTestUsersByPrefix
} from "../src/test/database.js";
import {
  assignAuthTestUserToField,
  AUTH_TEST_PASSWORD,
  AUTH_TEST_PREFIX,
  createAuthTestUser,
  createFieldSetupTestField,
  FIELD_SETUP_TEST_SLUG_PREFIX
} from "../src/test/fixtures.js";

const MOST_DATA_DESCRIPTION = "Common work measurements, notes, and values";

async function cleanupFieldSetupTestData(): Promise<void> {
  await cleanupTestFieldModulesBySlugPrefix(FIELD_SETUP_TEST_SLUG_PREFIX);
  await cleanupTestFieldModuleBySlug("most-data");
  await cleanupTestUsersByPrefix(AUTH_TEST_PREFIX);
}

async function authenticatedAgent(user: { username: string }) {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .send({ username: user.username, password: AUTH_TEST_PASSWORD })
    .expect(200);
  return agent;
}

beforeEach(async () => {
  await cleanupFieldSetupTestData();
});

afterAll(async () => {
  await cleanupFieldSetupTestData();
  await closeSessionStore();
  await prisma.$disconnect();
});

describe("assigned field catalog API", () => {
  it("authenticates before listing or resolving a field", async () => {
    const listResponse = await request(app).get("/api/fields");
    const detailResponse = await request(app).get("/api/fields/most-data");

    for (const response of [listResponse, detailResponse]) {
      expect(response.status).toBe(401);
      expect(response.body.error).toMatchObject({
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required.",
        requestId: response.headers["x-request-id"]
      });
    }
  });

  it("lists only assigned active fields in stable navigation order", async () => {
    const worker = await createAuthTestUser({ key: "field_list_worker" });
    const hidden = await createFieldSetupTestField({
      key: "hidden",
      displayOrder: 0
    });
    const mostData = await createFieldSetupTestField({
      key: "most_data",
      name: "Most Data",
      slug: "most-data",
      description: MOST_DATA_DESCRIPTION,
      displayOrder: 1
    });
    const secondary = await createFieldSetupTestField({
      key: "secondary",
      description: "Secondary assigned field",
      displayOrder: 2
    });
    const inactive = await createFieldSetupTestField({
      key: "inactive",
      displayOrder: 3,
      active: false
    });
    await assignAuthTestUserToField({
      userId: worker.id,
      fieldModuleId: mostData.id,
      canSubmit: false
    });
    await assignAuthTestUserToField({
      userId: worker.id,
      fieldModuleId: secondary.id
    });
    await assignAuthTestUserToField({
      userId: worker.id,
      fieldModuleId: inactive.id
    });
    const agent = await authenticatedAgent(worker);

    const response = await agent.get("/api/fields");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [
        {
          name: "Most Data",
          slug: "most-data",
          description: MOST_DATA_DESCRIPTION,
          route: "/fields/most-data",
          canSubmit: false
        },
        {
          name: secondary.name,
          slug: secondary.slug,
          description: "Secondary assigned field",
          route: `/fields/${secondary.slug}`,
          canSubmit: true
        }
      ]
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(worker.id);
    expect(serialized).not.toContain(mostData.id);
    expect(serialized).not.toContain(hidden.slug);
    expect(serialized).not.toContain(inactive.slug);
  });

  it("allows explicitly assigned Workers, Managers, and Admins to open a view-only field", async () => {
    const field = await createFieldSetupTestField({
      key: "role_matrix",
      name: "Most Data",
      slug: "most-data",
      description: MOST_DATA_DESCRIPTION,
      displayOrder: 1
    });

    for (const role of [Role.WORKER, Role.MANAGER, Role.ADMIN]) {
      const user = await createAuthTestUser({
        key: `field_detail_${role.toLowerCase()}`,
        role
      });
      await assignAuthTestUserToField({
        userId: user.id,
        fieldModuleId: field.id,
        canSubmit: false
      });
      const agent = await authenticatedAgent(user);

      await agent.get("/api/fields/most-data").expect(200, {
        data: {
          name: "Most Data",
          slug: "most-data",
          description: MOST_DATA_DESCRIPTION,
          route: "/fields/most-data",
          canSubmit: false
        }
      });
    }
  });

  it("returns an empty list and 403 detail for an unassigned authenticated user", async () => {
    const field = await createFieldSetupTestField({ key: "unassigned" });
    const manager = await createAuthTestUser({
      key: "unassigned_manager",
      role: Role.MANAGER
    });
    const agent = await authenticatedAgent(manager);

    await agent.get("/api/fields").expect(200, { data: [] });
    const response = await agent.get(`/api/fields/${field.slug}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      code: "FIELD_ACCESS_FORBIDDEN",
      message: "You do not have permission to access this field.",
      requestId: response.headers["x-request-id"]
    });
  });

  it("omits inactive fields and returns a non-disclosing 404 for inactive or missing fields", async () => {
    const field = await createFieldSetupTestField({
      key: "inactive_detail",
      active: false
    });
    const admin = await createAuthTestUser({
      key: "inactive_field_admin",
      role: Role.ADMIN
    });
    await assignAuthTestUserToField({
      userId: admin.id,
      fieldModuleId: field.id
    });
    const agent = await authenticatedAgent(admin);

    await agent.get("/api/fields").expect(200, { data: [] });
    const inactive = await agent.get(`/api/fields/${field.slug}`);
    const missing = await agent.get("/api/fields/missing-field");

    for (const response of [inactive, missing]) {
      expect(response.status).toBe(404);
      expect(response.body.error).toMatchObject({
        code: "FIELD_NOT_FOUND",
        message: "Field not found.",
        requestId: response.headers["x-request-id"]
      });
    }
  });

  it("observes permission changes and assignment removal without a new login", async () => {
    const field = await createFieldSetupTestField({ key: "current_access" });
    const worker = await createAuthTestUser({ key: "current_access_worker" });
    const assignment = await assignAuthTestUserToField({
      userId: worker.id,
      fieldModuleId: field.id,
      canSubmit: false
    });
    const agent = await authenticatedAgent(worker);

    expect((await agent.get(`/api/fields/${field.slug}`)).body.data.canSubmit).toBe(
      false
    );
    await prisma.userFieldAssignment.update({
      where: { id: assignment.id },
      data: { canSubmit: true }
    });
    expect((await agent.get(`/api/fields/${field.slug}`)).body.data.canSubmit).toBe(
      true
    );

    await prisma.userFieldAssignment.delete({ where: { id: assignment.id } });
    await agent.get("/api/fields").expect(200, { data: [] });
    const denied = await agent.get(`/api/fields/${field.slug}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FIELD_ACCESS_FORBIDDEN");
  });
});
