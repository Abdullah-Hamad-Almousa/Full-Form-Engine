import { FormStatus, InputType, Role } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  seedInitialApplication,
  type AdminSeedConfiguration
} from "../prisma/seed.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { closeSessionStore } from "../src/middleware/session.js";
import {
  cleanupTestFieldModuleBySlug,
  cleanupTestFieldModulesBySlugPrefix,
  cleanupTestUsersByPrefix,
  requireSafeTestDatabase
} from "../src/test/database.js";
import {
  assignAuthTestUserToField,
  AUTH_TEST_PASSWORD,
  AUTH_TEST_PREFIX,
  createAuthTestUser,
  createFieldSetupTestField
} from "../src/test/fixtures.js";
import { MOST_DATA_FORM_V1 } from "../src/validation/form-configuration.js";

const FORM_API_TEST_PREFIX = "phase2_form_api_";
const FORM_API_FIELD_PREFIX = "phase2-form-api-";

function createFormApiSeedConfiguration(): AdminSeedConfiguration {
  return {
    name: "Phase 2 Form API Seed Admin",
    username: `${FORM_API_TEST_PREFIX}seed_admin`,
    email: "phase2-form-api-seed-admin@example.local",
    password: "phase2-form-api-seed-password"
  };
}

async function cleanupFormApiTestData(): Promise<void> {
  await cleanupTestFieldModulesBySlugPrefix(FORM_API_FIELD_PREFIX);
  await cleanupTestFieldModuleBySlug("most-data");
  await cleanupTestUsersByPrefix(AUTH_TEST_PREFIX);
  await cleanupTestUsersByPrefix(FORM_API_TEST_PREFIX);
}

async function authenticatedAgent(user: { username: string }) {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .send({ username: user.username, password: AUTH_TEST_PASSWORD })
    .expect(200);
  return agent;
}

function expectedPublicForm(formVersionId: string) {
  return {
    formVersionId,
    versionNumber: MOST_DATA_FORM_V1.versionNumber,
    fields: MOST_DATA_FORM_V1.fields.map((configuredField) => ({
      fieldKey: configuredField.fieldKey,
      label: configuredField.label,
      inputType: configuredField.inputType,
      required: configuredField.required,
      placeholder: configuredField.placeholder,
      constraints: configuredField.constraints,
      options: configuredField.options.map(({ value, label }) => ({
        value,
        label
      }))
    })),
    rules: [
      {
        kind: "ALL_OR_NONE",
        fieldKeys: ["quantityValue", "quantityUnit"]
      }
    ]
  };
}

beforeEach(async () => {
  requireSafeTestDatabase();
  await cleanupFormApiTestData();
});

afterAll(async () => {
  await cleanupFormApiTestData();
  await closeSessionStore();
  await prisma.$disconnect();
});

describe("published field form API", () => {
  it("requires authentication before resolving a form", async () => {
    const response = await request(app).get("/api/fields/most-data/form");

    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      message: "Authentication is required.",
      requestId: response.headers["x-request-id"]
    });
  });

  it("denies an authenticated user without a current field assignment", async () => {
    await seedInitialApplication(createFormApiSeedConfiguration());
    const worker = await createAuthTestUser({ key: "phase2_form_unassigned" });
    const agent = await authenticatedAgent(worker);

    const response = await agent.get("/api/fields/most-data/form");

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      code: "FIELD_ACCESS_FORBIDDEN",
      message: "You do not have permission to access this field.",
      requestId: response.headers["x-request-id"]
    });
  });

  it("returns the stable public v1 DTO to assigned view-only Workers, Managers, and Admins", async () => {
    const seeded = await seedInitialApplication(createFormApiSeedConfiguration());
    const inactiveField = await prisma.formField.create({
      data: {
        formVersionId: seeded.formVersionId,
        fieldKey: "internalInactiveField",
        label: "Internal inactive field",
        inputType: InputType.TEXT,
        displayOrder: 1,
        active: false
      }
    });
    const heatUnit = await prisma.formField.findUniqueOrThrow({
      where: {
        formVersionId_fieldKey: {
          formVersionId: seeded.formVersionId,
          fieldKey: "heatUnit"
        }
      }
    });
    const inactiveOption = await prisma.fieldOption.create({
      data: {
        formFieldId: heatUnit.id,
        value: "INACTIVE_UNIT",
        label: "Inactive unit",
        displayOrder: 1,
        active: false
      }
    });

    for (const role of [Role.WORKER, Role.MANAGER, Role.ADMIN]) {
      const user = await createAuthTestUser({
        key: `phase2_form_view_only_${role.toLowerCase()}`,
        role
      });
      await assignAuthTestUserToField({
        userId: user.id,
        fieldModuleId: seeded.fieldModuleId,
        canSubmit: false
      });
      const agent = await authenticatedAgent(user);

      const response = await agent.get("/api/fields/most-data/form");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        data: expectedPublicForm(seeded.formVersionId)
      });
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain(seeded.adminId);
      expect(serialized).not.toContain(seeded.fieldModuleId);
      expect(serialized).not.toContain(heatUnit.id);
      expect(serialized).not.toContain(inactiveField.id);
      expect(serialized).not.toContain(inactiveField.fieldKey);
      expect(serialized).not.toContain(inactiveOption.id);
      expect(serialized).not.toContain(inactiveOption.value);
    }
  });

  it("returns non-disclosing field errors for inactive and missing fields", async () => {
    const inactiveField = await createFieldSetupTestField({
      key: "phase2_form_inactive",
      slug: `${FORM_API_FIELD_PREFIX}inactive`,
      active: false
    });
    const admin = await createAuthTestUser({
      key: "phase2_form_inactive_admin",
      role: Role.ADMIN
    });
    await assignAuthTestUserToField({
      userId: admin.id,
      fieldModuleId: inactiveField.id,
      canSubmit: false
    });
    const agent = await authenticatedAgent(admin);

    const responses = [
      await agent.get(`/api/fields/${inactiveField.slug}/form`),
      await agent.get("/api/fields/missing-field/form")
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body.error).toMatchObject({
        code: "FIELD_NOT_FOUND",
        message: "Field not found.",
        requestId: response.headers["x-request-id"]
      });
    }
  });

  it("returns FORM_NOT_AVAILABLE when an assigned field has no published version", async () => {
    const field = await createFieldSetupTestField({
      key: "phase2_form_unavailable",
      slug: `${FORM_API_FIELD_PREFIX}unavailable`
    });
    const manager = await createAuthTestUser({
      key: "phase2_form_unavailable_manager",
      role: Role.MANAGER
    });
    await assignAuthTestUserToField({
      userId: manager.id,
      fieldModuleId: field.id,
      canSubmit: false
    });
    await prisma.formVersion.create({
      data: {
        fieldModuleId: field.id,
        versionNumber: 1,
        status: FormStatus.DRAFT,
        createdById: manager.id
      }
    });
    const agent = await authenticatedAgent(manager);

    const response = await agent.get(`/api/fields/${field.slug}/form`);

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({
      code: "FORM_NOT_AVAILABLE",
      message: "A form is not currently available for this field.",
      requestId: response.headers["x-request-id"]
    });
  });

  it("returns and logs a safe invariant error when multiple versions are published", async () => {
    const seeded = await seedInitialApplication(createFormApiSeedConfiguration());
    await prisma.formVersion.create({
      data: {
        fieldModuleId: seeded.fieldModuleId,
        versionNumber: 2,
        status: FormStatus.PUBLISHED,
        publishedAt: new Date(),
        createdById: seeded.adminId
      }
    });
    const worker = await createAuthTestUser({ key: "phase2_form_invariant" });
    await assignAuthTestUserToField({
      userId: worker.id,
      fieldModuleId: seeded.fieldModuleId,
      canSubmit: false
    });
    const agent = await authenticatedAgent(worker);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await agent.get("/api/fields/most-data/form");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId: response.headers["x-request-id"]
      }
    });
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]?.[0])).toContain(
      response.headers["x-request-id"]
    );
    expect(JSON.stringify(response.body)).not.toContain(seeded.adminId);
    expect(JSON.stringify(response.body)).not.toContain(seeded.fieldModuleId);
  });
});
