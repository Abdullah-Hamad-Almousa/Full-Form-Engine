import { Role } from "@prisma/client";
import express from "express";
import request, { type Response } from "supertest";
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { authenticate } from "../src/middleware/authenticate.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { requireFieldAccess } from "../src/middleware/require-field-access.js";
import { requireRole } from "../src/middleware/require-role.js";
import {
  closeSessionStore,
  createSessionCookieOptions,
  sessionMiddleware
} from "../src/middleware/session.js";
import { authRouter } from "../src/routes/auth.routes.js";
import {
  cleanupTestFieldModulesBySlugPrefix,
  cleanupTestUsersByPrefix,
  expireSessionsForUser,
  findSessionsForUser
} from "../src/test/database.js";
import {
  assignAuthTestUserToField,
  AUTH_TEST_PASSWORD,
  AUTH_TEST_PREFIX,
  createAuthTestUser,
  createFieldAccessTestField,
  FIELD_ACCESS_TEST_SLUG_PREFIX
} from "../src/test/fixtures.js";

function getSetCookieHeaders(response: Response): string[] {
  const header = response.headers["set-cookie"];
  if (!header) {
    throw new Error("Expected a Set-Cookie response header.");
  }
  return Array.isArray(header) ? header : [header];
}

function getSessionCookie(response: Response): string {
  const [header] = getSetCookieHeaders(response);
  const cookie = header?.split(";", 1)[0];
  if (!cookie) {
    throw new Error("Expected a session cookie.");
  }
  return cookie;
}

async function login(
  username: string,
  password = AUTH_TEST_PASSWORD
): Promise<Response> {
  return request(app).post("/api/auth/login").send({ username, password });
}

const authorizationApp = express();
authorizationApp.set("trust proxy", 1);
authorizationApp.use(requestIdMiddleware);
authorizationApp.use(express.json({ limit: "1mb" }));
authorizationApp.use(sessionMiddleware);
authorizationApp.use("/api/auth", authRouter);
authorizationApp.post(
  "/test/roles/admin",
  authenticate,
  requireRole(Role.ADMIN),
  (request, response) => {
    response.json({ data: { userId: request.currentUser?.id } });
  }
);
authorizationApp.get(
  "/test/roles/manager",
  authenticate,
  requireRole(Role.MANAGER),
  (request, response) => {
    response.json({ data: { userId: request.currentUser?.id } });
  }
);
authorizationApp.get(
  "/test/fields/:fieldSlug",
  authenticate,
  requireFieldAccess(),
  (request, response) => {
    response.json({ data: { fieldAccess: request.fieldAccess } });
  }
);
authorizationApp.post(
  "/test/fields/:fieldSlug/submissions",
  authenticate,
  requireFieldAccess({ requireCanSubmit: true }),
  (request, response) => {
    response.json({ data: { fieldAccess: request.fieldAccess } });
  }
);
authorizationApp.use(errorHandler);

async function cleanupAuthorizationTestData(): Promise<void> {
  await cleanupTestUsersByPrefix(AUTH_TEST_PREFIX);
  await cleanupTestFieldModulesBySlugPrefix(FIELD_ACCESS_TEST_SLUG_PREFIX);
}

afterAll(async () => {
  await cleanupAuthorizationTestData();
  await closeSessionStore();
  await prisma.$disconnect();
});

describe("authentication API", () => {
  beforeEach(async () => {
    await cleanupTestUsersByPrefix(AUTH_TEST_PREFIX);
  });

  it("creates a minimal PostgreSQL session for valid active credentials", async () => {
    const user = await createAuthTestUser({ key: "valid_login" });
    const response = await login(user.username);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          role: user.role
        }
      }
    });
    expect(JSON.stringify(response.body)).not.toContain(user.passwordHash);
    expect(JSON.stringify(response.body)).not.toContain(AUTH_TEST_PASSWORD);

    const [cookie] = getSetCookieHeaders(response);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");

    const sessions = await findSessionsForUser(user.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sess).toMatchObject({ userId: user.id });
    expect(Object.keys(sessions[0]?.sess as object).sort()).toEqual([
      "cookie",
      "userId"
    ]);
    expect(JSON.stringify(sessions[0]?.sess)).not.toContain("password");
    expect(JSON.stringify(sessions[0]?.sess)).not.toContain("ADMIN");
  });

  it("uses one generic failure for unknown, incorrect, and inactive credentials", async () => {
    const activeUser = await createAuthTestUser({ key: "wrong_password" });
    const inactiveUser = await createAuthTestUser({
      key: "inactive",
      active: false
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const unknown = await login(
      `${AUTH_TEST_PREFIX}unknown`,
      "unknown-secret-value"
    );
    const incorrect = await login(activeUser.username, "incorrect-secret-value");
    const inactive = await login(inactiveUser.username);

    for (const response of [unknown, incorrect, inactive]) {
      expect(response.status).toBe(401);
      expect(response.body.error).toMatchObject({
        code: "INVALID_CREDENTIALS",
        message: "Invalid username or password."
      });
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    expect(unknown.body.error.code).toBe(incorrect.body.error.code);
    expect(unknown.body.error.message).toBe(incorrect.body.error.message);
    expect(incorrect.body.error.code).toBe(inactive.body.error.code);
    expect(incorrect.body.error.message).toBe(inactive.body.error.message);

    const loggedValues = JSON.stringify(warning.mock.calls);
    expect(loggedValues).not.toContain(`${AUTH_TEST_PREFIX}unknown`);
    expect(loggedValues).not.toContain("unknown-secret-value");
    expect(loggedValues).not.toContain("incorrect-secret-value");
  });

  it("rejects invalid and unknown credential fields with 422", async () => {
    const empty = await request(app)
      .post("/api/auth/login")
      .send({ username: "", password: "" });
    const wrongTypes = await request(app)
      .post("/api/auth/login")
      .send({ username: 42, password: false });
    const unknownField = await request(app)
      .post("/api/auth/login")
      .send({ username: "worker", password: "secret", role: "ADMIN" });

    for (const response of [empty, wrongTypes, unknownField]) {
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
      expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
    }
    expect(empty.body.error.fields).toMatchObject({
      username: expect.any(String),
      password: expect.any(String)
    });
  });

  it("returns a safe 400 response for malformed JSON", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"username":');

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: "MALFORMED_JSON",
      message: "Request body contains malformed JSON.",
      requestId: response.headers["x-request-id"]
    });
    expect(response.body.error).not.toHaveProperty("stack");
  });

  it("regenerates an existing session when login succeeds again", async () => {
    const user = await createAuthTestUser({ key: "regenerate" });
    const agent = request.agent(app);

    const firstLogin = await agent
      .post("/api/auth/login")
      .send({ username: user.username, password: AUTH_TEST_PASSWORD });
    const firstCookie = getSessionCookie(firstLogin);

    const secondLogin = await agent
      .post("/api/auth/login")
      .send({ username: user.username, password: AUTH_TEST_PASSWORD });
    const secondCookie = getSessionCookie(secondLogin);

    expect(secondCookie).not.toBe(firstCookie);
    await expect(findSessionsForUser(user.id)).resolves.toHaveLength(1);
  });

  it("returns the current active user and rejects a missing or forged session", async () => {
    const user = await createAuthTestUser({ key: "current_user" });
    const agent = request.agent(app);

    await agent
      .post("/api/auth/login")
      .send({ username: user.username, password: AUTH_TEST_PASSWORD })
      .expect(200);

    const currentUser = await agent.get("/api/auth/me");
    expect(currentUser.status).toBe(200);
    expect(currentUser.body.data.user).toMatchObject({
      id: user.id,
      username: user.username,
      role: user.role
    });

    const missing = await request(app).get("/api/auth/me");
    const forged = await request(app)
      .get("/api/auth/me")
      .set("Cookie", "field_app_session=forged-session-value");

    for (const response of [missing, forged]) {
      expect(response.status).toBe(401);
      expect(response.body.error).toMatchObject({
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required.",
        requestId: response.headers["x-request-id"]
      });
    }
  });

  it("rejects an expired session", async () => {
    const user = await createAuthTestUser({ key: "expired" });
    const agent = request.agent(app);

    await agent
      .post("/api/auth/login")
      .send({ username: user.username, password: AUTH_TEST_PASSWORD })
      .expect(200);
    await expireSessionsForUser(user.id);

    const response = await agent.get("/api/auth/me");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("invalidates a session when the current account becomes inactive", async () => {
    const user = await createAuthTestUser({ key: "became_inactive" });
    const agent = request.agent(app);

    await agent
      .post("/api/auth/login")
      .send({ username: user.username, password: AUTH_TEST_PASSWORD })
      .expect(200);
    await prisma.user.update({
      where: { id: user.id },
      data: { active: false }
    });

    const response = await agent.get("/api/auth/me");
    expect(response.status).toBe(401);
    await expect(findSessionsForUser(user.id)).resolves.toHaveLength(0);
  });

  it("invalidates a session when its user no longer exists", async () => {
    const user = await createAuthTestUser({ key: "deleted_user" });
    const agent = request.agent(app);

    await agent
      .post("/api/auth/login")
      .send({ username: user.username, password: AUTH_TEST_PASSWORD })
      .expect(200);
    await prisma.user.delete({ where: { id: user.id } });

    const response = await agent.get("/api/auth/me");
    expect(response.status).toBe(401);
    await expect(findSessionsForUser(user.id)).resolves.toHaveLength(0);
  });

  it("destroys the session, clears the cookie, and handles repeat logout", async () => {
    const user = await createAuthTestUser({ key: "logout" });
    const agent = request.agent(app);

    await agent
      .post("/api/auth/login")
      .send({ username: user.username, password: AUTH_TEST_PASSWORD })
      .expect(200);

    const firstLogout = await agent.post("/api/auth/logout");
    expect(firstLogout.status).toBe(204);
    expect(getSetCookieHeaders(firstLogout)[0]).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    );
    await expect(findSessionsForUser(user.id)).resolves.toHaveLength(0);
    await agent.get("/api/auth/me").expect(401);
    await agent.post("/api/auth/logout").expect(204);
  });

  it("builds secure and local cookie options from validated configuration", () => {
    expect(
      createSessionCookieOptions({ secure: true, ttlHours: 2, sameSite: "strict" })
    ).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      path: "/",
      maxAge: 7_200_000
    });
    expect(
      createSessionCookieOptions({ secure: false, ttlHours: 12, sameSite: "lax" })
    ).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 43_200_000
    });
  });
});

describe("role and field-access authorization", () => {
  const roles = [Role.WORKER, Role.MANAGER, Role.ADMIN];

  beforeEach(async () => {
    await cleanupAuthorizationTestData();
  });

  it("authenticates before evaluating role or field access", async () => {
    const roleResponse = await request(authorizationApp).post(
      "/test/roles/admin"
    );
    const fieldResponse = await request(authorizationApp).get(
      `/test/fields/${FIELD_ACCESS_TEST_SLUG_PREFIX}missing`
    );

    for (const response of [roleResponse, fieldResponse]) {
      expect(response.status).toBe(401);
      expect(response.body.error).toMatchObject({
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required.",
        requestId: response.headers["x-request-id"]
      });
    }
  });

  it("uses explicit role allowlists without trusting request claims or Admin hierarchy", async () => {
    const worker = await createAuthTestUser({ key: "role_worker" });
    const manager = await createAuthTestUser({
      key: "role_manager",
      role: Role.MANAGER
    });
    const admin = await createAuthTestUser({
      key: "role_admin",
      role: Role.ADMIN
    });
    const workerAgent = request.agent(authorizationApp);
    const managerAgent = request.agent(authorizationApp);
    const adminAgent = request.agent(authorizationApp);

    await workerAgent
      .post("/api/auth/login")
      .send({ username: worker.username, password: AUTH_TEST_PASSWORD })
      .expect(200);
    await managerAgent
      .post("/api/auth/login")
      .send({ username: manager.username, password: AUTH_TEST_PASSWORD })
      .expect(200);
    await adminAgent
      .post("/api/auth/login")
      .send({ username: admin.username, password: AUTH_TEST_PASSWORD })
      .expect(200);

    const forged = await workerAgent
      .post("/test/roles/admin")
      .send({ role: Role.ADMIN, userId: admin.id, workerId: admin.id });
    const managerDenied = await managerAgent.post("/test/roles/admin");
    const adminDeniedManager = await adminAgent.get("/test/roles/manager");

    for (const response of [forged, managerDenied, adminDeniedManager]) {
      expect(response.status).toBe(403);
      expect(response.body.error).toMatchObject({
        code: "ROLE_FORBIDDEN",
        message: "You do not have permission to perform this action.",
        requestId: response.headers["x-request-id"]
      });
    }

    await adminAgent.post("/test/roles/admin").expect(200, {
      data: { userId: admin.id }
    });
    await managerAgent.get("/test/roles/manager").expect(200, {
      data: { userId: manager.id }
    });
  });

  it("enforces a database role downgrade on the next request", async () => {
    const admin = await createAuthTestUser({
      key: "role_downgrade",
      role: Role.ADMIN
    });
    const agent = request.agent(authorizationApp);

    await agent
      .post("/api/auth/login")
      .send({ username: admin.username, password: AUTH_TEST_PASSWORD })
      .expect(200);
    await agent.post("/test/roles/admin").expect(200);
    await prisma.user.update({
      where: { id: admin.id },
      data: { role: Role.WORKER }
    });

    const response = await agent.post("/test/roles/admin");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ROLE_FORBIDDEN");
  });

  it("allows every explicitly assigned role to access an active field", async () => {
    const field = await createFieldAccessTestField({ key: "assigned" });

    for (const role of roles) {
      const user = await createAuthTestUser({
        key: `assigned_${role.toLowerCase()}`,
        role
      });
      const assignment = await assignAuthTestUserToField({
        userId: user.id,
        fieldModuleId: field.id
      });
      const agent = request.agent(authorizationApp);
      await agent
        .post("/api/auth/login")
        .send({ username: user.username, password: AUTH_TEST_PASSWORD })
        .expect(200);

      await agent.get(`/test/fields/${field.slug}`).expect(200, {
        data: {
          fieldAccess: {
            fieldModuleId: field.id,
            fieldSlug: field.slug,
            assignmentId: assignment.id,
            canSubmit: true
          }
        }
      });
    }
  });

  it("denies unassigned roles and does not allow changing the field URL", async () => {
    const assignedField = await createFieldAccessTestField({
      key: "url_assigned"
    });
    const otherField = await createFieldAccessTestField({ key: "url_other" });

    for (const role of roles) {
      const user = await createAuthTestUser({
        key: `unassigned_${role.toLowerCase()}`,
        role
      });
      const agent = request.agent(authorizationApp);
      await agent
        .post("/api/auth/login")
        .send({ username: user.username, password: AUTH_TEST_PASSWORD })
        .expect(200);

      const response = await agent.get(`/test/fields/${assignedField.slug}`);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FIELD_ACCESS_FORBIDDEN");
    }

    const worker = await createAuthTestUser({ key: "url_worker" });
    await assignAuthTestUserToField({
      userId: worker.id,
      fieldModuleId: assignedField.id
    });
    const workerAgent = request.agent(authorizationApp);
    await workerAgent
      .post("/api/auth/login")
      .send({ username: worker.username, password: AUTH_TEST_PASSWORD })
      .expect(200);
    await workerAgent.get(`/test/fields/${assignedField.slug}`).expect(200);

    const changedUrl = await workerAgent.get(`/test/fields/${otherField.slug}`);
    expect(changedUrl.status).toBe(403);
    expect(changedUrl.body.error).toMatchObject({
      code: "FIELD_ACCESS_FORBIDDEN",
      message: "You do not have permission to access this field.",
      requestId: changedUrl.headers["x-request-id"]
    });
  });

  it("requires current canSubmit permission for every role", async () => {
    const field = await createFieldAccessTestField({ key: "submit" });

    for (const role of roles) {
      const user = await createAuthTestUser({
        key: `submit_${role.toLowerCase()}`,
        role
      });
      const assignment = await assignAuthTestUserToField({
        userId: user.id,
        fieldModuleId: field.id,
        canSubmit: false
      });
      const agent = request.agent(authorizationApp);
      await agent
        .post("/api/auth/login")
        .send({ username: user.username, password: AUTH_TEST_PASSWORD })
        .expect(200);

      await agent.get(`/test/fields/${field.slug}`).expect(200);
      const denied = await agent
        .post(`/test/fields/${field.slug}/submissions`)
        .send({ canSubmit: true, role: Role.ADMIN });
      expect(denied.status).toBe(403);
      expect(denied.body.error).toMatchObject({
        code: "FIELD_SUBMISSION_FORBIDDEN",
        message: "You do not have permission to submit to this field.",
        requestId: denied.headers["x-request-id"]
      });

      await prisma.userFieldAssignment.update({
        where: { id: assignment.id },
        data: { canSubmit: true }
      });
      await agent
        .post(`/test/fields/${field.slug}/submissions`)
        .send({ canSubmit: false, role: Role.WORKER })
        .expect(200, {
          data: {
            fieldAccess: {
              fieldModuleId: field.id,
              fieldSlug: field.slug,
              assignmentId: assignment.id,
              canSubmit: true
            }
          }
        });
    }
  });

  it("enforces assignment removal without requiring a new login", async () => {
    const field = await createFieldAccessTestField({ key: "removed" });
    const worker = await createAuthTestUser({ key: "removed_worker" });
    const assignment = await assignAuthTestUserToField({
      userId: worker.id,
      fieldModuleId: field.id
    });
    const agent = request.agent(authorizationApp);

    await agent
      .post("/api/auth/login")
      .send({ username: worker.username, password: AUTH_TEST_PASSWORD })
      .expect(200);
    await agent.get(`/test/fields/${field.slug}`).expect(200);
    await prisma.userFieldAssignment.delete({
      where: { id: assignment.id }
    });

    const response = await agent.get(`/test/fields/${field.slug}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FIELD_ACCESS_FORBIDDEN");
  });

  it("returns a non-disclosing 404 when a field becomes inactive or is missing", async () => {
    const field = await createFieldAccessTestField({ key: "inactive" });
    const worker = await createAuthTestUser({ key: "inactive_worker" });
    await assignAuthTestUserToField({
      userId: worker.id,
      fieldModuleId: field.id
    });
    const agent = request.agent(authorizationApp);

    await agent
      .post("/api/auth/login")
      .send({ username: worker.username, password: AUTH_TEST_PASSWORD })
      .expect(200);
    await agent.get(`/test/fields/${field.slug}`).expect(200);
    await prisma.fieldModule.update({
      where: { id: field.id },
      data: { active: false }
    });

    const inactive = await agent.get(`/test/fields/${field.slug}`);
    const missing = await agent.get(
      `/test/fields/${FIELD_ACCESS_TEST_SLUG_PREFIX}missing`
    );
    for (const response of [inactive, missing]) {
      expect(response.status).toBe(404);
      expect(response.body.error).toMatchObject({
        code: "FIELD_NOT_FOUND",
        message: "Field not found.",
        requestId: response.headers["x-request-id"]
      });
    }
  });
});
