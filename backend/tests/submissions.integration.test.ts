import { FormStatus, InputType, Role } from "@prisma/client";
import request, { type Response } from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { closeSessionStore } from "../src/middleware/session.js";
import { createSubmission } from "../src/services/submission.service.js";
import {
  cleanupTestFieldModuleBySlug,
  cleanupTestFieldModulesBySlugPrefix,
  cleanupTestUsersByPrefix,
  expireSessionsForUser,
  requireSafeTestDatabase
} from "../src/test/database.js";
import {
  assignAuthTestUserToField,
  AUTH_TEST_PASSWORD,
  AUTH_TEST_PREFIX,
  createAuthTestUser,
  createMostDataSubmissionFixture,
  SUBMISSION_TEST_KEY_PREFIX,
  SUBMISSION_TEST_OTHER_FIELD_SLUG_PREFIX
} from "../src/test/fixtures.js";
import type { SubmissionEnvelope } from "../src/validation/submission.schema.js";

const SUBMISSION_ROUTE = "/api/fields/most-data/submissions";
const SUBMISSION_TEST_USER_PREFIX =
  `${AUTH_TEST_PREFIX}${SUBMISSION_TEST_KEY_PREFIX}`;

const VALID_RESPONSE_DATA = {
  workDate: "2026-08-25",
  workTime: "08:30",
  locationId: "building-a",
  shiftId: "morning",
  heatValue: 42.567,
  heatUnit: "CELSIUS",
  status: "NORMAL",
  quantityValue: 125.125,
  quantityUnit: "KG",
  issueDetected: false,
  notes: "Equipment checked.\n<script>remains plain data</script>"
} as const;

type SubmissionFixture = Awaited<
  ReturnType<typeof createMostDataSubmissionFixture>
>;

function submissionEnvelope(
  formVersionId: string,
  responseData: Record<string, unknown> = { ...VALID_RESPONSE_DATA }
): SubmissionEnvelope {
  return {
    formVersionId,
    confirmed: true,
    responseData
  };
}

async function expectServiceRejectedWithoutSubmission({
  run,
  code
}: {
  run: () => Promise<unknown>;
  code: string;
}): Promise<void> {
  const beforeCount = await prisma.submission.count();
  let rejection: unknown;

  try {
    await run();
  } catch (error) {
    rejection = error;
  }

  expect(rejection).toMatchObject({ status: 409, code });
  await expect(prisma.submission.count()).resolves.toBe(beforeCount);
}

function withoutKey(
  value: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const result = { ...value };
  delete result[key];
  return result;
}

async function authenticatedAgent(user: { username: string }) {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .send({ username: user.username, password: AUTH_TEST_PASSWORD })
    .expect(200);
  return agent;
}

async function expectRejectedWithoutSubmission({
  run,
  status,
  code,
  field
}: {
  run: () => Promise<Response>;
  status: number;
  code: string;
  field?: string;
}): Promise<Response> {
  const beforeCount = await prisma.submission.count();
  const response = await run();

  expect(response.status).toBe(status);
  expect(response.body.error).toMatchObject({
    code,
    requestId: response.headers["x-request-id"]
  });
  expect(response.body.error.message).toEqual(expect.any(String));
  if (field) {
    expect(response.body.error.fields).toHaveProperty(field);
  }
  expect(JSON.stringify(response.body)).not.toMatch(
    /Prisma|node_modules|[A-Z]:\\|SELECT\s|INSERT\s/
  );
  await expect(prisma.submission.count()).resolves.toBe(beforeCount);
  return response;
}

async function cleanupSubmissionTestData(): Promise<void> {
  requireSafeTestDatabase();
  await cleanupTestFieldModulesBySlugPrefix(
    SUBMISSION_TEST_OTHER_FIELD_SLUG_PREFIX
  );
  await cleanupTestFieldModuleBySlug("most-data");
  await cleanupTestUsersByPrefix(SUBMISSION_TEST_USER_PREFIX);
}

async function createAdditionalAssignedUser({
  fixture,
  key,
  role,
  canSubmit = true
}: {
  fixture: SubmissionFixture;
  key: string;
  role: Role;
  canSubmit?: boolean;
}) {
  const user = await createAuthTestUser({
    key: `${SUBMISSION_TEST_KEY_PREFIX}${key}`,
    role
  });
  const assignment = await assignAuthTestUserToField({
    userId: user.id,
    fieldModuleId: fixture.fieldModule.id,
    canSubmit
  });
  return { user, assignment };
}

beforeEach(async () => {
  requireSafeTestDatabase();
  await cleanupSubmissionTestData();
});

afterAll(async () => {
  await cleanupSubmissionTestData();
  await closeSessionStore();
  await prisma.$disconnect();
});

describe("submission authentication and authorization", () => {
  it("rejects missing, expired, and inactive sessions without writing", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "session_matrix"
    });
    const body = submissionEnvelope(fixture.formVersion.id);

    await expectRejectedWithoutSubmission({
      run: async () => request(app).post(SUBMISSION_ROUTE).send(body),
      status: 401,
      code: "AUTHENTICATION_REQUIRED"
    });

    const expiredAgent = await authenticatedAgent(fixture.user);
    await expireSessionsForUser(fixture.user.id);
    await expectRejectedWithoutSubmission({
      run: async () => expiredAgent.post(SUBMISSION_ROUTE).send(body),
      status: 401,
      code: "AUTHENTICATION_REQUIRED"
    });

    const inactiveUser = await createAdditionalAssignedUser({
      fixture,
      key: "inactive_session",
      role: Role.WORKER
    });
    const inactiveAgent = await authenticatedAgent(inactiveUser.user);
    await prisma.user.update({
      where: { id: inactiveUser.user.id },
      data: { active: false }
    });
    await expectRejectedWithoutSubmission({
      run: async () => inactiveAgent.post(SUBMISSION_ROUTE).send(body),
      status: 401,
      code: "AUTHENTICATION_REQUIRED"
    });
  });

  it("requires assignment and canSubmit for Workers, Managers, and Admins", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "permission_matrix"
    });
    const body = submissionEnvelope(fixture.formVersion.id);

    for (const role of [Role.WORKER, Role.MANAGER, Role.ADMIN]) {
      const unassigned = await createAuthTestUser({
        key: `${SUBMISSION_TEST_KEY_PREFIX}unassigned_${role.toLowerCase()}`,
        role
      });
      const unassignedAgent = await authenticatedAgent(unassigned);
      await expectRejectedWithoutSubmission({
        run: async () => unassignedAgent.post(SUBMISSION_ROUTE).send(body),
        status: 403,
        code: "FIELD_ACCESS_FORBIDDEN"
      });

      const viewOnly = await createAdditionalAssignedUser({
        fixture,
        key: `view_only_${role.toLowerCase()}`,
        role,
        canSubmit: false
      });
      const viewOnlyAgent = await authenticatedAgent(viewOnly.user);
      await expectRejectedWithoutSubmission({
        run: async () => viewOnlyAgent.post(SUBMISSION_ROUTE).send(body),
        status: 403,
        code: "FIELD_SUBMISSION_FORBIDDEN"
      });
    }
  });

  it("observes assignment, canSubmit, and field-active changes on the request", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "current_access"
    });
    const body = submissionEnvelope(fixture.formVersion.id);
    const agent = await authenticatedAgent(fixture.user);

    await prisma.userFieldAssignment.update({
      where: { id: fixture.assignment?.id },
      data: { canSubmit: false }
    });
    await expectRejectedWithoutSubmission({
      run: async () => agent.post(SUBMISSION_ROUTE).send(body),
      status: 403,
      code: "FIELD_SUBMISSION_FORBIDDEN"
    });

    await prisma.userFieldAssignment.delete({
      where: { id: fixture.assignment?.id }
    });
    await expectRejectedWithoutSubmission({
      run: async () => agent.post(SUBMISSION_ROUTE).send(body),
      status: 403,
      code: "FIELD_ACCESS_FORBIDDEN"
    });

    await assignAuthTestUserToField({
      userId: fixture.user.id,
      fieldModuleId: fixture.fieldModule.id
    });
    await prisma.fieldModule.update({
      where: { id: fixture.fieldModule.id },
      data: { active: false }
    });
    await expectRejectedWithoutSubmission({
      run: async () => agent.post(SUBMISSION_ROUTE).send(body),
      status: 404,
      code: "FIELD_NOT_FOUND"
    });
  });
});

describe("submission request contract", () => {
  it("returns a safe 400 for malformed JSON and never writes", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "malformed_json"
    });
    const agent = await authenticatedAgent(fixture.user);

    const response = await expectRejectedWithoutSubmission({
      run: async () =>
        agent
          .post(SUBMISSION_ROUTE)
          .set("Content-Type", "application/json")
          .send('{"formVersionId":'),
      status: 400,
      code: "MALFORMED_JSON"
    });

    expect(response.body.error).not.toHaveProperty("stack");
  });

  it("validates well-formed JSON primitives as requests instead of parser syntax errors", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "json_primitives"
    });
    const agent = await authenticatedAgent(fixture.user);

    for (const primitive of ['"string request"', "42", "true", "null"]) {
      await expectRejectedWithoutSubmission({
        run: async () =>
          agent
            .post(SUBMISSION_ROUTE)
            .set("Content-Type", "application/json")
            .send(primitive),
        status: 422,
        code: "VALIDATION_FAILED",
        field: "request"
      });
    }
  });

  it("rejects a JSON body above 1 MB before persistence with a safe 413 envelope", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "oversized_body"
    });
    const agent = await authenticatedAgent(fixture.user);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await expectRejectedWithoutSubmission({
      run: async () =>
        agent.post(SUBMISSION_ROUTE).send(
          submissionEnvelope(fixture.formVersion.id, {
            ...VALID_RESPONSE_DATA,
            notes: "x".repeat(1_100_000)
          })
        ),
      status: 413,
      code: "PAYLOAD_TOO_LARGE"
    });

    expect(response.body).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body is too large.",
        requestId: response.headers["x-request-id"]
      }
    });
    expect(response.body.error).not.toHaveProperty("stack");
    expect(JSON.stringify(response.body)).not.toContain("x".repeat(100));
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("requires literal confirmation through the direct API", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "confirmation"
    });
    const agent = await authenticatedAgent(fixture.user);
    const base = submissionEnvelope(fixture.formVersion.id);

    for (const body of [withoutKey(base, "confirmed"), { ...base, confirmed: false }]) {
      await expectRejectedWithoutSubmission({
        run: async () => agent.post(SUBMISSION_ROUTE).send(body),
        status: 422,
        code: "CONFIRMATION_REQUIRED",
        field: "confirmed"
      });
    }
  });

  it("rejects missing envelope members and invalid responseData shapes", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "envelope_shape"
    });
    const agent = await authenticatedAgent(fixture.user);
    const base = submissionEnvelope(fixture.formVersion.id);
    const cases: Array<{
      body: Record<string, unknown> | unknown[] | string;
      field: string;
    }> = [
      { body: withoutKey(base, "formVersionId"), field: "formVersionId" },
      { body: withoutKey(base, "responseData"), field: "responseData" },
      { body: { ...base, formVersionId: 42 }, field: "formVersionId" },
      { body: { ...base, responseData: [] }, field: "responseData" },
      { body: { ...base, responseData: "not-an-object" }, field: "responseData" }
    ];

    for (const testCase of cases) {
      await expectRejectedWithoutSubmission({
        run: async () => agent.post(SUBMISSION_ROUTE).send(testCase.body),
        status: 422,
        code: "VALIDATION_FAILED",
        field: testCase.field
      });
    }
  });

  it("rejects every extra top-level identity, permission, and metadata claim", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "trusted_envelope"
    });
    const agent = await authenticatedAgent(fixture.user);
    const base = submissionEnvelope(fixture.formVersion.id);
    const trustedClaims: Record<string, unknown> = {
      userId: "another-user",
      workerId: "another-worker",
      role: "ADMIN",
      assignmentId: "another-assignment",
      canSubmit: true,
      workDate: "1999-01-01",
      entryDate: "1999-01-01",
      confirmedByUserId: "another-confirmer",
      confirmedAt: "1999-01-01T00:00:00.000Z",
      confirmationTextVersion: 999,
      createdAt: "1999-01-01T00:00:00.000Z"
    };

    for (const [field, value] of Object.entries(trustedClaims)) {
      await expectRejectedWithoutSubmission({
        run: async () =>
          agent.post(SUBMISSION_ROUTE).send({ ...base, [field]: value }),
        status: 422,
        code: "VALIDATION_FAILED",
        field
      });
    }
  });

  it("does not expose another mutating method for the submission collection", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "unsupported_method"
    });
    const agent = await authenticatedAgent(fixture.user);

    await expectRejectedWithoutSubmission({
      run: async () =>
        agent
          .put(SUBMISSION_ROUTE)
          .send(submissionEnvelope(fixture.formVersion.id)),
      status: 404,
      code: "NOT_FOUND"
    });
  });
});

describe("published-form response validation", () => {
  it("rejects missing configured required values with public field errors", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "required_fields"
    });
    const agent = await authenticatedAgent(fixture.user);
    const requiredFields = [
      "workDate",
      "workTime",
      "locationId",
      "shiftId",
      "heatValue",
      "heatUnit",
      "status"
    ];

    for (const field of requiredFields) {
      await expectRejectedWithoutSubmission({
        run: async () =>
          agent.post(SUBMISSION_ROUTE).send(
            submissionEnvelope(
              fixture.formVersion.id,
              withoutKey(VALID_RESPONSE_DATA, field)
            )
          ),
        status: 422,
        code: "VALIDATION_FAILED",
        field
      });
    }
  });

  it("enforces the exact configured JSON type for every supported input kind", async () => {
    const fixture = await createMostDataSubmissionFixture({ key: "types" });
    const agent = await authenticatedAgent(fixture.user);
    const cases: Array<{ field: string; value: unknown }> = [
      { field: "workDate", value: 20260825 },
      { field: "workTime", value: true },
      { field: "locationId", value: 1 },
      { field: "heatValue", value: "42.5" },
      { field: "issueDetected", value: "false" },
      { field: "notes", value: 100 }
    ];

    for (const testCase of cases) {
      await expectRejectedWithoutSubmission({
        run: async () =>
          agent.post(SUBMISSION_ROUTE).send(
            submissionEnvelope(fixture.formVersion.id, {
              ...VALID_RESPONSE_DATA,
              [testCase.field]: testCase.value
            })
          ),
        status: 422,
        code: "VALIDATION_FAILED",
        field: testCase.field
      });
    }
  });

  it("rejects present blank strings for optional typed values and pair members", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "blank_optional_types"
    });
    const agent = await authenticatedAgent(fixture.user);
    const pairBypassAttempt = withoutKey(
      { ...VALID_RESPONSE_DATA, quantityValue: "" },
      "quantityUnit"
    );
    const cases: Array<{
      responseData: Record<string, unknown>;
      fields: string[];
    }> = [
      {
        responseData: { ...VALID_RESPONSE_DATA, quantityValue: " \t" },
        fields: ["quantityValue"]
      },
      {
        responseData: { ...VALID_RESPONSE_DATA, quantityUnit: "" },
        fields: ["quantityUnit"]
      },
      {
        responseData: { ...VALID_RESPONSE_DATA, issueDetected: " " },
        fields: ["issueDetected"]
      },
      {
        responseData: pairBypassAttempt,
        fields: ["quantityValue", "quantityUnit"]
      }
    ];

    for (const testCase of cases) {
      const response = await expectRejectedWithoutSubmission({
        run: async () =>
          agent
            .post(SUBMISSION_ROUTE)
            .send(submissionEnvelope(fixture.formVersion.id, testCase.responseData)),
        status: 422,
        code: "VALIDATION_FAILED",
        field: testCase.fields[0]
      });
      for (const field of testCase.fields) {
        expect(response.body.error.fields).toHaveProperty(field);
      }
    }
  });

  it("accepts only exact calendar dates and 24-hour HH:mm times", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "date_time"
    });
    const agent = await authenticatedAgent(fixture.user);
    const cases = [
      { field: "workDate", value: "2026-02-30" },
      { field: "workDate", value: "25-08-2026" },
      { field: "workDate", value: "2026-8-25" },
      { field: "workTime", value: "24:00" },
      { field: "workTime", value: "8:30" },
      { field: "workTime", value: "08:30:00" }
    ];

    for (const testCase of cases) {
      await expectRejectedWithoutSubmission({
        run: async () =>
          agent.post(SUBMISSION_ROUTE).send(
            submissionEnvelope(fixture.formVersion.id, {
              ...VALID_RESPONSE_DATA,
              [testCase.field]: testCase.value
            })
          ),
        status: 422,
        code: "VALIDATION_FAILED",
        field: testCase.field
      });
    }
  });

  it("enforces current active selection options", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "options"
    });
    const agent = await authenticatedAgent(fixture.user);

    await expectRejectedWithoutSubmission({
      run: async () =>
        agent.post(SUBMISSION_ROUTE).send(
          submissionEnvelope(fixture.formVersion.id, {
            ...VALID_RESPONSE_DATA,
            status: "UNKNOWN"
          })
        ),
      status: 422,
      code: "VALIDATION_FAILED",
      field: "status"
    });

    const heatUnitField = await prisma.formField.findUniqueOrThrow({
      where: {
        formVersionId_fieldKey: {
          formVersionId: fixture.formVersion.id,
          fieldKey: "heatUnit"
        }
      }
    });
    await prisma.fieldOption.update({
      where: {
        formFieldId_value: {
          formFieldId: heatUnitField.id,
          value: "CELSIUS"
        }
      },
      data: { active: false }
    });
    await expectRejectedWithoutSubmission({
      run: async () =>
        agent
          .post(SUBMISSION_ROUTE)
          .send(submissionEnvelope(fixture.formVersion.id)),
      status: 422,
      code: "VALIDATION_FAILED",
      field: "heatUnit"
    });
  });

  it("enforces configured numeric bounds and decimal precision without rounding", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "numeric_constraints"
    });
    const agent = await authenticatedAgent(fixture.user);
    await prisma.formField.update({
      where: {
        formVersionId_fieldKey: {
          formVersionId: fixture.formVersion.id,
          fieldKey: "heatValue"
        }
      },
      data: { minValue: 0, maxValue: 100, decimalPlaces: 2 }
    });

    for (const heatValue of [-0.01, 100.01, 42.567]) {
      await expectRejectedWithoutSubmission({
        run: async () =>
          agent.post(SUBMISSION_ROUTE).send(
            submissionEnvelope(fixture.formVersion.id, {
              ...VALID_RESPONSE_DATA,
              heatValue
            })
          ),
        status: 422,
        code: "VALIDATION_FAILED",
        field: "heatValue"
      });
    }

    await expectRejectedWithoutSubmission({
      run: async () =>
        agent
          .post(SUBMISSION_ROUTE)
          .set("Content-Type", "application/json")
          .send(
            JSON.stringify(submissionEnvelope(fixture.formVersion.id)).replace(
              '"heatValue":42.567',
              '"heatValue":1e400'
            )
          ),
      status: 422,
      code: "VALIDATION_FAILED",
      field: "heatValue"
    });
  });

  it("enforces the Heat and Quantity pair rules", async () => {
    const fixture = await createMostDataSubmissionFixture({ key: "pairs" });
    const agent = await authenticatedAgent(fixture.user);
    const cases = [
      { omitted: "heatValue", expectedField: "heatValue" },
      { omitted: "heatUnit", expectedField: "heatUnit" },
      { omitted: "quantityValue", expectedField: "quantityValue" },
      { omitted: "quantityUnit", expectedField: "quantityUnit" }
    ];

    for (const testCase of cases) {
      await expectRejectedWithoutSubmission({
        run: async () =>
          agent.post(SUBMISSION_ROUTE).send(
            submissionEnvelope(
              fixture.formVersion.id,
              withoutKey(VALID_RESPONSE_DATA, testCase.omitted)
            )
          ),
        status: 422,
        code: "VALIDATION_FAILED",
        field: testCase.expectedField
      });
    }
  });

  it("rejects nested replacements, unknown fields, and trusted response metadata", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "unknown_response_fields"
    });
    const agent = await authenticatedAgent(fixture.user);
    const unknownValues: Record<string, unknown> = {
      heat: { value: 42.567, unit: "CELSIUS" },
      userId: "another-user",
      workerId: "another-worker",
      role: "ADMIN",
      entryDate: "1999-01-01",
      confirmedByUserId: "another-confirmer",
      confirmedAt: "1999-01-01T00:00:00.000Z",
      confirmationTextVersion: 999,
      createdAt: "1999-01-01T00:00:00.000Z"
    };

    for (const [field, value] of Object.entries(unknownValues)) {
      await expectRejectedWithoutSubmission({
        run: async () =>
          agent.post(SUBMISSION_ROUTE).send(
            submissionEnvelope(fixture.formVersion.id, {
              ...VALID_RESPONSE_DATA,
              [field]: value
            })
          ),
        status: 422,
        code: "VALIDATION_FAILED",
        field
      });
    }

    await expectRejectedWithoutSubmission({
      run: async () =>
        agent.post(SUBMISSION_ROUTE).send(
          submissionEnvelope(fixture.formVersion.id, {
            ...VALID_RESPONSE_DATA,
            heatValue: { value: 42.567 }
          })
        ),
      status: 422,
      code: "VALIDATION_FAILED",
      field: "heatValue"
    });
  });

  it("rejects inactive configured fields and notes above the effective limit", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "inactive_and_notes"
    });
    const agent = await authenticatedAgent(fixture.user);
    await prisma.formField.create({
      data: {
        formVersionId: fixture.formVersion.id,
        fieldKey: "legacyField",
        label: "Legacy field",
        inputType: InputType.TEXT,
        displayOrder: 999,
        active: false
      }
    });

    await expectRejectedWithoutSubmission({
      run: async () =>
        agent.post(SUBMISSION_ROUTE).send(
          submissionEnvelope(fixture.formVersion.id, {
            ...VALID_RESPONSE_DATA,
            legacyField: "must not be accepted"
          })
        ),
      status: 422,
      code: "VALIDATION_FAILED",
      field: "legacyField"
    });
    await expectRejectedWithoutSubmission({
      run: async () =>
        agent.post(SUBMISSION_ROUTE).send(
          submissionEnvelope(fixture.formVersion.id, {
            ...VALID_RESPONSE_DATA,
            notes: "n".repeat(2_001)
          })
        ),
      status: 422,
      code: "VALIDATION_FAILED",
      field: "notes"
    });
  });
});

describe("current published form enforcement", () => {
  it("returns FORM_VERSION_NOT_CURRENT for unknown, draft, archived, and other-field versions", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "stale_versions"
    });
    const agent = await authenticatedAgent(fixture.user);
    const draft = await prisma.formVersion.create({
      data: {
        fieldModuleId: fixture.fieldModule.id,
        versionNumber: 2,
        status: FormStatus.DRAFT,
        createdById: fixture.user.id
      }
    });
    const archived = await prisma.formVersion.create({
      data: {
        fieldModuleId: fixture.fieldModule.id,
        versionNumber: 3,
        status: FormStatus.ARCHIVED,
        publishedAt: new Date("2026-08-24T00:00:00.000Z"),
        createdById: fixture.user.id
      }
    });
    const otherField = await prisma.fieldModule.create({
      data: {
        name: "Other Phase 4 field",
        slug: `${SUBMISSION_TEST_OTHER_FIELD_SLUG_PREFIX}stale`
      }
    });
    const otherFieldForm = await prisma.formVersion.create({
      data: {
        fieldModuleId: otherField.id,
        versionNumber: 1,
        status: FormStatus.PUBLISHED,
        publishedAt: new Date(),
        createdById: fixture.user.id
      }
    });

    for (const formVersionId of [
      "unknown-form-version",
      draft.id,
      archived.id,
      otherFieldForm.id
    ]) {
      await expectRejectedWithoutSubmission({
        run: async () =>
          agent
            .post(SUBMISSION_ROUTE)
            .send(submissionEnvelope(formVersionId)),
        status: 409,
        code: "FORM_VERSION_NOT_CURRENT",
        field: "formVersionId"
      });
    }
  });

  it("rejects a formerly published version when no current form remains", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "no_current_form"
    });
    const agent = await authenticatedAgent(fixture.user);
    await prisma.formVersion.update({
      where: { id: fixture.formVersion.id },
      data: { status: FormStatus.ARCHIVED }
    });

    await expectRejectedWithoutSubmission({
      run: async () =>
        agent
          .post(SUBMISSION_ROUTE)
          .send(submissionEnvelope(fixture.formVersion.id)),
      status: 409,
      code: "FORM_VERSION_NOT_CURRENT",
      field: "formVersionId"
    });
  });

  it("returns a safe internal error when the one-published-form invariant is broken", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "published_invariant"
    });
    const agent = await authenticatedAgent(fixture.user);
    await prisma.formVersion.create({
      data: {
        fieldModuleId: fixture.fieldModule.id,
        versionNumber: 2,
        status: FormStatus.PUBLISHED,
        publishedAt: new Date(),
        createdById: fixture.user.id
      }
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await expectRejectedWithoutSubmission({
      run: async () =>
        agent
          .post(SUBMISSION_ROUTE)
          .send(submissionEnvelope(fixture.formVersion.id)),
      status: 500,
      code: "INTERNAL_ERROR"
    });

    expect(response.body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId: response.headers["x-request-id"]
      }
    });
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});

describe("transactional current-state rechecks", () => {
  it("rolls back submission creation when its durable audit insert fails", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "audit_rollback"
    });
    const beforeSubmissionCount = await prisma.submission.count();
    const beforeAuditCount = await prisma.auditLog.count();

    await expect(
      createSubmission({
        actorId: fixture.user.id,
        fieldModuleId: fixture.fieldModule.id,
        fieldSlug: fixture.fieldModule.slug,
        requestId: "invalid\u0000request-id",
        envelope: submissionEnvelope(fixture.formVersion.id)
      })
    ).rejects.toBeDefined();

    await expect(prisma.submission.count()).resolves.toBe(beforeSubmissionCount);
    await expect(prisma.auditLog.count()).resolves.toBe(beforeAuditCount);
  });

  it("rechecks actor, field, assignment existence, and canSubmit inside createSubmission", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "service_current_state"
    });
    if (!fixture.assignment) {
      throw new Error("Submission fixture assignment is missing.");
    }

    const invokeService = (requestId: string) =>
      createSubmission({
        actorId: fixture.user.id,
        fieldModuleId: fixture.fieldModule.id,
        fieldSlug: fixture.fieldModule.slug,
        requestId,
        envelope: submissionEnvelope(fixture.formVersion.id)
      });

    await prisma.user.update({
      where: { id: fixture.user.id },
      data: { active: false }
    });
    await expectServiceRejectedWithoutSubmission({
      run: async () => invokeService("service-actor-inactive"),
      code: "SUBMISSION_CONFLICT"
    });
    await prisma.user.update({
      where: { id: fixture.user.id },
      data: { active: true }
    });

    await prisma.fieldModule.update({
      where: { id: fixture.fieldModule.id },
      data: { active: false }
    });
    await expectServiceRejectedWithoutSubmission({
      run: async () => invokeService("service-field-inactive"),
      code: "SUBMISSION_CONFLICT"
    });
    await prisma.fieldModule.update({
      where: { id: fixture.fieldModule.id },
      data: { active: true }
    });

    await prisma.userFieldAssignment.delete({
      where: { id: fixture.assignment.id }
    });
    await expectServiceRejectedWithoutSubmission({
      run: async () => invokeService("service-assignment-removed"),
      code: "SUBMISSION_CONFLICT"
    });
    const replacementAssignment = await assignAuthTestUserToField({
      userId: fixture.user.id,
      fieldModuleId: fixture.fieldModule.id,
      canSubmit: false
    });
    await expectServiceRejectedWithoutSubmission({
      run: async () => invokeService("service-can-submit-revoked"),
      code: "SUBMISSION_CONFLICT"
    });
    await prisma.userFieldAssignment.update({
      where: { id: replacementAssignment.id },
      data: { canSubmit: true }
    });
  });

  it("rechecks archived and replaced form versions inside createSubmission", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "service_form_current"
    });
    const invokeService = (requestId: string) =>
      createSubmission({
        actorId: fixture.user.id,
        fieldModuleId: fixture.fieldModule.id,
        fieldSlug: fixture.fieldModule.slug,
        requestId,
        envelope: submissionEnvelope(fixture.formVersion.id)
      });

    await prisma.formVersion.update({
      where: { id: fixture.formVersion.id },
      data: { status: FormStatus.ARCHIVED }
    });
    await expectServiceRejectedWithoutSubmission({
      run: async () => invokeService("service-form-archived"),
      code: "FORM_VERSION_NOT_CURRENT"
    });

    await prisma.formVersion.create({
      data: {
        fieldModuleId: fixture.fieldModule.id,
        versionNumber: 2,
        status: FormStatus.PUBLISHED,
        publishedAt: new Date(),
        createdById: fixture.user.id
      }
    });
    await expectServiceRejectedWithoutSubmission({
      run: async () => invokeService("service-form-replaced"),
      code: "FORM_VERSION_NOT_CURRENT"
    });
  });
});

describe("submission persistence and public success contract", () => {
  it("treats two separately accepted POSTs as two intentional submissions", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "repeat_after_success"
    });
    const agent = await authenticatedAgent(fixture.user);
    const body = submissionEnvelope(fixture.formVersion.id);
    const beforeCount = await prisma.submission.count();

    const first = await agent.post(SUBMISSION_ROUTE).send(body);
    const second = await agent.post(SUBMISSION_ROUTE).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body).toEqual({ data: { id: expect.any(String) } });
    expect(second.body).toEqual({ data: { id: expect.any(String) } });
    expect(second.body.data.id).not.toBe(first.body.data.id);
    await expect(prisma.submission.count()).resolves.toBe(beforeCount + 2);
    await expect(
      prisma.submission.findMany({
        where: { id: { in: [first.body.data.id, second.body.data.id] } },
        select: { id: true }
      })
    ).resolves.toHaveLength(2);
  });

  it("allows assigned Workers, Managers, and Admins to create exactly one row each", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "role_success_worker",
      role: Role.WORKER
    });
    const manager = await createAdditionalAssignedUser({
      fixture,
      key: "role_success_manager",
      role: Role.MANAGER
    });
    const admin = await createAdditionalAssignedUser({
      fixture,
      key: "role_success_admin",
      role: Role.ADMIN
    });
    const actors = [fixture.user, manager.user, admin.user];

    for (const actor of actors) {
      const agent = await authenticatedAgent(actor);
      const beforeCount = await prisma.submission.count();
      const response = await agent
        .post(SUBMISSION_ROUTE)
        .send(submissionEnvelope(fixture.formVersion.id));

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ data: { id: expect.any(String) } });
      await expect(prisma.submission.count()).resolves.toBe(beforeCount + 1);
      const stored = await prisma.submission.findUniqueOrThrow({
        where: { id: response.body.data.id }
      });
      expect(stored.userId).toBe(actor.id);
      expect(stored.confirmedByUserId).toBe(actor.id);
    }
  });

  it("stores only canonical public responses and server-derived trusted metadata", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "trusted_persistence"
    });
    const agent = await authenticatedAgent(fixture.user);
    const responseData = {
      ...VALID_RESPONSE_DATA,
      heatValue: 42.567890123,
      quantityValue: 125.1256789,
      notes: "  First line\nSecond line with ' OR 1=1 --  "
    };
    const before = new Date();

    const response = await agent
      .post(SUBMISSION_ROUTE)
      .send(submissionEnvelope(fixture.formVersion.id, responseData));
    const after = new Date();

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ data: { id: expect.any(String) } });
    expect(Object.keys(response.body)).toEqual(["data"]);
    expect(Object.keys(response.body.data)).toEqual(["id"]);

    const stored = await prisma.submission.findUniqueOrThrow({
      where: { id: response.body.data.id }
    });
    expect(stored).toMatchObject({
      id: response.body.data.id,
      fieldModuleId: fixture.fieldModule.id,
      formVersionId: fixture.formVersion.id,
      userId: fixture.user.id,
      confirmedByUserId: fixture.user.id,
      confirmationTextVersion: 1,
      responseData: {
        ...responseData,
        notes: "First line\nSecond line with ' OR 1=1 --"
      }
    });
    expect(stored.workDate.toISOString()).toBe("2026-08-25T00:00:00.000Z");
    expect(stored.confirmedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(stored.confirmedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(stored.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(stored.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(stored.responseData).not.toHaveProperty("confirmed");
    const auditRows = await prisma.$queryRaw<
      Array<{
        action: string;
        entityType: string;
        entityId: string;
        actorUserId: string;
        actorRole: string;
        reason: string | null;
        oldValue: unknown;
        newValue: unknown;
        requestId: string | null;
      }>
    >`
      SELECT
        "action",
        "entity_type" AS "entityType",
        "entity_id" AS "entityId",
        "actor_user_id" AS "actorUserId",
        "actor_role"::text AS "actorRole",
        "reason",
        "old_value" AS "oldValue",
        "new_value" AS "newValue",
        "request_id" AS "requestId"
      FROM "audit_logs"
      WHERE "entity_id" = ${stored.id}
    `;
    expect(auditRows).toEqual([
      {
        action: "SUBMISSION_CREATED",
        entityType: "SUBMISSION",
        entityId: stored.id,
        actorUserId: fixture.user.id,
        actorRole: "WORKER",
        reason: null,
        oldValue: null,
        newValue: {
          id: stored.id,
          fieldModuleId: fixture.fieldModule.id,
          formVersionId: fixture.formVersion.id,
          userId: fixture.user.id,
          workDate: "2026-08-25",
          responseData: stored.responseData,
          confirmedByUserId: fixture.user.id,
          confirmedAt: stored.confirmedAt.toISOString(),
          confirmationTextVersion: 1,
          createdAt: stored.createdAt.toISOString(),
          updatedAt: stored.updatedAt.toISOString(),
          recordState: "ACTIVE",
          deletedAt: null
        },
        requestId: response.headers["x-request-id"]
      }
    ]);
  });

  it("canonicalizes omission of optional values while retaining Boolean false", async () => {
    const fixture = await createMostDataSubmissionFixture({
      key: "optional_values"
    });
    const agent = await authenticatedAgent(fixture.user);
    const responseData = withoutKey(
      withoutKey(
        withoutKey(
          withoutKey(VALID_RESPONSE_DATA, "quantityValue"),
          "quantityUnit"
        ),
        "notes"
      ),
      "unused"
    );

    const response = await agent
      .post(SUBMISSION_ROUTE)
      .send(
        submissionEnvelope(fixture.formVersion.id, {
          ...responseData,
          notes: " \n\t "
        })
      );

    expect(response.status).toBe(201);
    const stored = await prisma.submission.findUniqueOrThrow({
      where: { id: response.body.data.id }
    });
    expect(stored.responseData).toEqual(responseData);
    expect(stored.responseData).toMatchObject({ issueDetected: false });
    expect(stored.responseData).not.toHaveProperty("quantityValue");
    expect(stored.responseData).not.toHaveProperty("quantityUnit");
    expect(stored.responseData).not.toHaveProperty("notes");
  });

  it("emits one safe structured submission_created log after persistence", async () => {
    const fixture = await createMostDataSubmissionFixture({ key: "safe_log" });
    const agent = await authenticatedAgent(fixture.user);
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await agent
      .post(SUBMISSION_ROUTE)
      .send(submissionEnvelope(fixture.formVersion.id));

    expect(response.status).toBe(201);
    const eventCalls = infoLog.mock.calls
      .map(([entry]) => String(entry))
      .filter((entry) => entry.includes('"event":"submission_created"'));
    expect(eventCalls).toHaveLength(1);
    const event = JSON.parse(eventCalls[0] ?? "{}") as Record<string, unknown>;
    expect(event).toMatchObject({
      level: "info",
      event: "submission_created",
      requestId: response.headers["x-request-id"],
      actorId: fixture.user.id,
      fieldModuleId: fixture.fieldModule.id,
      resourceId: response.body.data.id,
      formVersionId: fixture.formVersion.id,
      outcome: "success"
    });
    expect(event.timestamp).toEqual(expect.any(String));
    const serializedLog = JSON.stringify(event);
    expect(serializedLog).not.toContain("responseData");
    expect(serializedLog).not.toContain(VALID_RESPONSE_DATA.notes);
    expect(serializedLog).not.toContain(AUTH_TEST_PASSWORD);
    expect(serializedLog).not.toContain("session");
    await expect(
      prisma.submission.findUnique({ where: { id: response.body.data.id } })
    ).resolves.not.toBeNull();
  });
});
