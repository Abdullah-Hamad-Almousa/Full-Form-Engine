import { FormStatus, Role } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../services/password.service.js";
import { MOST_DATA_FORM_V1 } from "../validation/form-configuration.js";

export const AUTH_TEST_PASSWORD = "phase1-test-password";
export const AUTH_TEST_PREFIX = "phase1_auth_";
export const FIELD_ACCESS_TEST_SLUG_PREFIX = "phase1-access-";
export const FIELD_SETUP_TEST_SLUG_PREFIX = "phase1-field-setup-";
export const SUBMISSION_TEST_KEY_PREFIX = "phase4_submission_";
export const SUBMISSION_TEST_OTHER_FIELD_SLUG_PREFIX =
  "phase4-submission-other-";

export type CreateAuthTestUserOptions = {
  key: string;
  active?: boolean;
  password?: string;
  role?: Role;
  managerId?: string;
};

export async function createAuthTestUser({
  key,
  active = true,
  password = AUTH_TEST_PASSWORD,
  role = Role.WORKER,
  managerId
}: CreateAuthTestUserOptions) {
  const username = `${AUTH_TEST_PREFIX}${key}`;
  return prisma.user.create({
    data: {
      name: `Phase 1 ${key}`,
      username,
      email: `${username}@example.local`,
      passwordHash: await hashPassword(password),
      role,
      managerId,
      active
    }
  });
}

export async function createFieldAccessTestField({
  key,
  active = true
}: {
  key: string;
  active?: boolean;
}) {
  return prisma.fieldModule.create({
    data: {
      name: `Phase 1 ${key}`,
      slug: `${FIELD_ACCESS_TEST_SLUG_PREFIX}${key}`,
      active
    }
  });
}

export async function createFieldSetupTestField({
  key,
  name = `Phase 1 Field Setup ${key}`,
  slug = `${FIELD_SETUP_TEST_SLUG_PREFIX}${key}`,
  description = null,
  displayOrder = 0,
  active = true
}: {
  key: string;
  name?: string;
  slug?: string;
  description?: string | null;
  displayOrder?: number;
  active?: boolean;
}) {
  return prisma.fieldModule.create({
    data: { name, slug, description, displayOrder, active }
  });
}

export async function assignAuthTestUserToField({
  userId,
  fieldModuleId,
  canSubmit = true
}: {
  userId: string;
  fieldModuleId: string;
  canSubmit?: boolean;
}) {
  return prisma.userFieldAssignment.create({
    data: { userId, fieldModuleId, canSubmit }
  });
}

export type CreateMostDataSubmissionFixtureOptions = {
  key: string;
  role?: Role;
  assigned?: boolean;
  canSubmit?: boolean;
  fieldActive?: boolean;
};

export async function createMostDataSubmissionFixture({
  key,
  role = Role.WORKER,
  assigned = true,
  canSubmit = true,
  fieldActive = true
}: CreateMostDataSubmissionFixtureOptions) {
  const user = await createAuthTestUser({
    key: `${SUBMISSION_TEST_KEY_PREFIX}${key}`,
    role
  });
  const fieldModule = await prisma.fieldModule.create({
    data: {
      name: "Most Data",
      slug: MOST_DATA_FORM_V1.fieldSlug,
      description: "Phase 4 submission integration fixture",
      displayOrder: 1,
      active: fieldActive
    }
  });
  const formVersion = await prisma.formVersion.create({
    data: {
      fieldModuleId: fieldModule.id,
      versionNumber: MOST_DATA_FORM_V1.versionNumber,
      status: FormStatus.PUBLISHED,
      publishedAt: new Date(),
      createdById: user.id,
      fields: {
        create: MOST_DATA_FORM_V1.fields.map((configuredField) => ({
          fieldKey: configuredField.fieldKey,
          label: configuredField.label,
          inputType: configuredField.inputType,
          required: configuredField.required,
          unit: configuredField.unit,
          placeholder: configuredField.placeholder,
          minValue: configuredField.constraints.minValue,
          maxValue: configuredField.constraints.maxValue,
          decimalPlaces: configuredField.constraints.decimalPlaces,
          displayOrder: configuredField.displayOrder,
          showInTable: configuredField.showInTable,
          showInGraph: configuredField.showInGraph,
          active: configuredField.active,
          options: {
            create: configuredField.options.map((configuredOption) => ({
              value: configuredOption.value,
              label: configuredOption.label,
              displayOrder: configuredOption.displayOrder,
              active: configuredOption.active
            }))
          }
        }))
      }
    }
  });
  const assignment = assigned
    ? await assignAuthTestUserToField({
        userId: user.id,
        fieldModuleId: fieldModule.id,
        canSubmit
      })
    : null;

  return { user, fieldModule, formVersion, assignment };
}
