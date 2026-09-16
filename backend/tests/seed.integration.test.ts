import { FormStatus, Role } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  InitialFormConfigurationConflictError,
  MOST_DATA_FIELD,
  readAdminSeedConfiguration,
  seedInitialAdmin,
  seedInitialApplication,
  type AdminSeedConfiguration
} from "../prisma/seed.js";
import { prisma } from "../src/lib/prisma.js";
import { verifyPassword } from "../src/services/password.service.js";
import {
  cleanupTestFieldModuleBySlug,
  cleanupTestUsersByPrefix,
  requireSafeTestDatabase
} from "../src/test/database.js";
import { MOST_DATA_FORM_V1 } from "../src/validation/form-configuration.js";

const SEED_TEST_PREFIX = "phase1_seed_";

function createSeedConfiguration(
  overrides: Partial<AdminSeedConfiguration> = {}
): AdminSeedConfiguration {
  return {
    name: "Phase 1 Seed Admin",
    username: `${SEED_TEST_PREFIX}admin`,
    email: "phase1-seed-admin@example.local",
    password: "phase1-seed-password",
    ...overrides
  };
}

describe("initial application seed", () => {
  beforeEach(async () => {
    await cleanupTestFieldModuleBySlug("most-data");
    await cleanupTestUsersByPrefix(SEED_TEST_PREFIX);
  });

  afterAll(async () => {
    await cleanupTestFieldModuleBySlug("most-data");
    await cleanupTestUsersByPrefix(SEED_TEST_PREFIX);
    await prisma.$disconnect();
  });

  it("rejects missing or malformed seed configuration without echoing values", () => {
    const secret = "must-not-appear-in-errors";

    expect(() =>
      readAdminSeedConfiguration({ ADMIN_PASSWORD: secret })
    ).toThrow(/ADMIN_NAME/);
    expect(() =>
      readAdminSeedConfiguration({
        ADMIN_NAME: "Admin",
        ADMIN_USERNAME: `${SEED_TEST_PREFIX}invalid_email`,
        ADMIN_EMAIL: "not-an-email",
        ADMIN_PASSWORD: secret
      })
    ).toThrow(/ADMIN_EMAIL/);

    try {
      readAdminSeedConfiguration({ ADMIN_PASSWORD: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("creates one active Argon2-backed Admin and converges on rerun", async () => {
    requireSafeTestDatabase();
    const initial = createSeedConfiguration();
    const updated = createSeedConfiguration({
      name: "Updated Phase 1 Seed Admin",
      email: "phase1-seed-admin-updated@example.local",
      password: "phase1-updated-seed-password"
    });

    await seedInitialAdmin(initial);
    await seedInitialAdmin(updated);

    const users = await prisma.user.findMany({
      where: { username: initial.username }
    });
    expect(users).toHaveLength(1);

    const [admin] = users;
    expect(admin).toMatchObject({
      name: updated.name,
      username: updated.username,
      email: updated.email,
      role: Role.ADMIN,
      active: true
    });
    expect(admin?.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(
      verifyPassword(admin?.passwordHash ?? "", updated.password)
    ).resolves.toBe(true);
    await expect(
      verifyPassword(admin?.passwordHash ?? "", initial.password)
    ).resolves.toBe(false);
  });

  it("atomically seeds the published Most Data form and converges without resetting assignment access", async () => {
    requireSafeTestDatabase();
    const configuration = createSeedConfiguration();

    const initialResult = await seedInitialApplication(configuration);

    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: configuration.username }
    });
    const field = await prisma.fieldModule.findUniqueOrThrow({
      where: { slug: MOST_DATA_FIELD.slug }
    });
    const assignment = await prisma.userFieldAssignment.findUniqueOrThrow({
      where: {
        userId_fieldModuleId: {
          userId: admin.id,
          fieldModuleId: field.id
        }
      }
    });
    const formVersion = await prisma.formVersion.findUniqueOrThrow({
      where: {
        fieldModuleId_versionNumber: {
          fieldModuleId: field.id,
          versionNumber: MOST_DATA_FORM_V1.versionNumber
        }
      },
      include: {
        fields: {
          include: {
            options: {
              orderBy: [{ displayOrder: "asc" }, { value: "asc" }]
            }
          },
          orderBy: [{ displayOrder: "asc" }, { fieldKey: "asc" }]
        }
      }
    });

    expect(field).toMatchObject(MOST_DATA_FIELD);
    expect(assignment.canSubmit).toBe(false);
    expect(initialResult).toEqual({
      adminId: admin.id,
      fieldModuleId: field.id,
      assignmentId: assignment.id,
      formVersionId: formVersion.id
    });
    expect(formVersion).toMatchObject({
      versionNumber: 1,
      status: FormStatus.PUBLISHED,
      createdById: admin.id
    });
    expect(formVersion.publishedAt).toBeInstanceOf(Date);
    expect(formVersion.fields).toHaveLength(11);
    expect(
      formVersion.fields.map(
        ({
          fieldKey,
          label,
          inputType,
          required,
          unit,
          placeholder,
          displayOrder,
          showInTable,
          showInGraph,
          active,
          minValue,
          maxValue,
          decimalPlaces,
          options
        }) => ({
          fieldKey,
          label,
          inputType,
          required,
          unit,
          placeholder,
          displayOrder,
          showInTable,
          showInGraph,
          active,
          minValue: minValue?.toString() ?? null,
          maxValue: maxValue?.toString() ?? null,
          decimalPlaces,
          options: options.map(
            ({ value, label: optionLabel, displayOrder: optionOrder, active }) => ({
              value,
              label: optionLabel,
              displayOrder: optionOrder,
              active
            })
          )
        })
      )
    ).toEqual(
      MOST_DATA_FORM_V1.fields.map((configuredField) => ({
        fieldKey: configuredField.fieldKey,
        label: configuredField.label,
        inputType: configuredField.inputType,
        required: configuredField.required,
        unit: configuredField.unit,
        placeholder: configuredField.placeholder,
        displayOrder: configuredField.displayOrder,
        showInTable: configuredField.showInTable,
        showInGraph: configuredField.showInGraph,
        active: configuredField.active,
        minValue:
          configuredField.constraints.minValue === null
            ? null
            : String(configuredField.constraints.minValue),
        maxValue:
          configuredField.constraints.maxValue === null
            ? null
            : String(configuredField.constraints.maxValue),
        decimalPlaces: configuredField.constraints.decimalPlaces,
        options: configuredField.options.map((configuredOption) => ({
          value: configuredOption.value,
          label: configuredOption.label,
          displayOrder: configuredOption.displayOrder,
          active: configuredOption.active
        }))
      }))
    );

    await prisma.userFieldAssignment.update({
      where: { id: assignment.id },
      data: { canSubmit: true }
    });
    const rerunResult = await seedInitialApplication(configuration);

    await expect(
      prisma.fieldModule.count({ where: { slug: MOST_DATA_FIELD.slug } })
    ).resolves.toBe(1);
    await expect(
      prisma.userFieldAssignment.count({
        where: { userId: admin.id, fieldModuleId: field.id }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.userFieldAssignment.findUniqueOrThrow({
        where: { id: assignment.id },
        select: { canSubmit: true }
      })
    ).resolves.toEqual({ canSubmit: true });
    await expect(
      prisma.formVersion.count({ where: { fieldModuleId: field.id } })
    ).resolves.toBe(1);
    await expect(
      prisma.formField.count({ where: { formVersionId: formVersion.id } })
    ).resolves.toBe(11);
    expect(rerunResult).toEqual(initialResult);
    await expect(
      prisma.formVersion.findUniqueOrThrow({
        where: { id: formVersion.id },
        select: { publishedAt: true, createdAt: true }
      })
    ).resolves.toEqual({
      publishedAt: formVersion.publishedAt,
      createdAt: formVersion.createdAt
    });
  });

  it("rejects and preserves a conflicting published version instead of repairing history", async () => {
    requireSafeTestDatabase();
    const configuration = createSeedConfiguration();
    const initialResult = await seedInitialApplication(configuration);
    const notes = await prisma.formField.findUniqueOrThrow({
      where: {
        formVersionId_fieldKey: {
          formVersionId: initialResult.formVersionId,
          fieldKey: "notes"
        }
      }
    });
    await prisma.formField.update({
      where: { id: notes.id },
      data: { label: "Changed historical notes label" }
    });
    await prisma.userFieldAssignment.update({
      where: { id: initialResult.assignmentId },
      data: { canSubmit: true }
    });

    await expect(
      seedInitialApplication(
        createSeedConfiguration({ name: "This update must roll back" })
      )
    ).rejects.toBeInstanceOf(InitialFormConfigurationConflictError);

    await expect(
      prisma.formField.findUniqueOrThrow({
        where: { id: notes.id },
        select: { label: true }
      })
    ).resolves.toEqual({ label: "Changed historical notes label" });
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: initialResult.adminId },
        select: { name: true }
      })
    ).resolves.toEqual({ name: configuration.name });
    await expect(
      prisma.userFieldAssignment.findUniqueOrThrow({
        where: { id: initialResult.assignmentId },
        select: { canSubmit: true }
      })
    ).resolves.toEqual({ canSubmit: true });
  });

  it("rejects an additional form version without changing either version", async () => {
    requireSafeTestDatabase();
    const configuration = createSeedConfiguration();
    const initialResult = await seedInitialApplication(configuration);
    const additionalVersion = await prisma.formVersion.create({
      data: {
        fieldModuleId: initialResult.fieldModuleId,
        versionNumber: 2,
        status: FormStatus.DRAFT,
        createdById: initialResult.adminId
      }
    });

    await expect(seedInitialApplication(configuration)).rejects.toBeInstanceOf(
      InitialFormConfigurationConflictError
    );
    await expect(
      prisma.formVersion.findMany({
        where: { fieldModuleId: initialResult.fieldModuleId },
        orderBy: { versionNumber: "asc" },
        select: { id: true, versionNumber: true, status: true }
      })
    ).resolves.toEqual([
      {
        id: initialResult.formVersionId,
        versionNumber: 1,
        status: FormStatus.PUBLISHED
      },
      {
        id: additionalVersion.id,
        versionNumber: 2,
        status: FormStatus.DRAFT
      }
    ]);
  });
});
