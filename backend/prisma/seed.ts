import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { FormStatus, Prisma, Role } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/services/password.service.js";
import {
  MOST_DATA_FORM_V1,
  validateVersionedFormDefinition,
  type FormFieldDefinition,
  type FormOptionDefinition
} from "../src/validation/form-configuration.js";

const adminSeedEnvironmentSchema = z.object({
  ADMIN_NAME: z.string().trim().min(1).max(200),
  ADMIN_USERNAME: z.string().trim().min(1).max(100),
  ADMIN_EMAIL: z.string().trim().email().max(320),
  ADMIN_PASSWORD: z.string().min(1).max(1024)
});

export type AdminSeedConfiguration = {
  name: string;
  username: string;
  email: string;
  password: string;
};

export const MOST_DATA_FIELD = {
  name: "Most Data",
  slug: "most-data",
  description: "Common work measurements, notes, and values",
  displayOrder: 1,
  active: true
} as const;

export class InitialFormConfigurationConflictError extends Error {
  constructor() {
    super(
      "The existing Most Data form history conflicts with the initial version-1 definition."
    );
    this.name = "InitialFormConfigurationConflictError";
  }
}

export function readAdminSeedConfiguration(
  environment: NodeJS.ProcessEnv
): AdminSeedConfiguration {
  const result = adminSeedEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues
          .map(({ path }) => path[0])
          .filter((field): field is string => typeof field === "string")
      )
    ].sort();
    throw new Error(`Invalid Admin seed configuration: ${fields.join(", ")}.`);
  }

  return {
    name: result.data.ADMIN_NAME,
    username: result.data.ADMIN_USERNAME,
    email: result.data.ADMIN_EMAIL,
    password: result.data.ADMIN_PASSWORD
  };
}

async function upsertInitialAdmin(
  database: Prisma.TransactionClient,
  {
    name,
    username,
    email
  }: Omit<AdminSeedConfiguration, "password">,
  passwordHash: string
): Promise<{ id: string }> {
  return database.user.upsert({
    where: { username },
    update: {
      name,
      email,
      passwordHash,
      role: Role.ADMIN,
      active: true,
      managerId: null
    },
    create: {
      name,
      username,
      email,
      passwordHash,
      role: Role.ADMIN,
      active: true
    },
    select: { id: true }
  });
}

export async function seedInitialAdmin({
  name,
  username,
  email,
  password
}: AdminSeedConfiguration): Promise<{ id: string }> {
  const passwordHash = await hashPassword(password);
  return upsertInitialAdmin(
    prisma,
    { name, username, email },
    passwordHash
  );
}

async function upsertMostDataField(
  database: Prisma.TransactionClient
): Promise<{ id: string }> {
  const { slug, ...fieldData } = MOST_DATA_FIELD;
  return database.fieldModule.upsert({
    where: { slug },
    update: fieldData,
    create: { slug, ...fieldData },
    select: { id: true }
  });
}

export async function seedMostDataField(): Promise<{ id: string }> {
  return upsertMostDataField(prisma);
}

type StoredSeedOption = {
  value: string;
  label: string;
  displayOrder: number;
  active: boolean;
};

type StoredSeedField = {
  fieldKey: string;
  label: string;
  inputType: FormFieldDefinition["inputType"];
  required: boolean;
  unit: string | null;
  placeholder: string | null;
  minValue: Prisma.Decimal | null;
  maxValue: Prisma.Decimal | null;
  decimalPlaces: number | null;
  displayOrder: number;
  showInTable: boolean;
  showInGraph: boolean;
  active: boolean;
  options: StoredSeedOption[];
};

type StoredSeedFormVersion = {
  id: string;
  versionNumber: number;
  status: FormStatus;
  publishedAt: Date | null;
  createdById: string;
  fields: StoredSeedField[];
};

function decimalMatches(
  stored: Prisma.Decimal | null,
  configured: number | null
): boolean {
  if (stored === null || configured === null) {
    return stored === null && configured === null;
  }
  return stored.equals(configured);
}

function optionMatches(
  stored: StoredSeedOption,
  configured: FormOptionDefinition
): boolean {
  return (
    stored.value === configured.value &&
    stored.label === configured.label &&
    stored.displayOrder === configured.displayOrder &&
    stored.active === configured.active
  );
}

function fieldMatches(
  stored: StoredSeedField,
  configured: FormFieldDefinition
): boolean {
  return (
    stored.fieldKey === configured.fieldKey &&
    stored.label === configured.label &&
    stored.inputType === configured.inputType &&
    stored.required === configured.required &&
    stored.unit === configured.unit &&
    stored.placeholder === configured.placeholder &&
    decimalMatches(stored.minValue, configured.constraints.minValue) &&
    decimalMatches(stored.maxValue, configured.constraints.maxValue) &&
    stored.decimalPlaces === configured.constraints.decimalPlaces &&
    stored.displayOrder === configured.displayOrder &&
    stored.showInTable === configured.showInTable &&
    stored.showInGraph === configured.showInGraph &&
    stored.active === configured.active &&
    stored.options.length === configured.options.length &&
    stored.options.every((storedOption, optionIndex) => {
      const configuredOption = configured.options[optionIndex];
      return Boolean(
        configuredOption && optionMatches(storedOption, configuredOption)
      );
    })
  );
}

function formVersionMatches(
  stored: StoredSeedFormVersion,
  createdById: string
): boolean {
  return (
    stored.versionNumber === MOST_DATA_FORM_V1.versionNumber &&
    stored.status === FormStatus.PUBLISHED &&
    stored.publishedAt !== null &&
    stored.createdById === createdById &&
    stored.fields.length === MOST_DATA_FORM_V1.fields.length &&
    stored.fields.every((storedField, fieldIndex) => {
      const configuredField = MOST_DATA_FORM_V1.fields[fieldIndex];
      return Boolean(
        configuredField && fieldMatches(storedField, configuredField)
      );
    })
  );
}

async function ensureInitialMostDataForm(
  database: Prisma.TransactionClient,
  fieldModuleId: string,
  createdById: string
): Promise<{ id: string }> {
  validateVersionedFormDefinition(MOST_DATA_FORM_V1);

  const existingVersions = await database.formVersion.findMany({
    where: { fieldModuleId },
    select: {
      id: true,
      versionNumber: true,
      status: true,
      publishedAt: true,
      createdById: true,
      fields: {
        select: {
          fieldKey: true,
          label: true,
          inputType: true,
          required: true,
          unit: true,
          placeholder: true,
          minValue: true,
          maxValue: true,
          decimalPlaces: true,
          displayOrder: true,
          showInTable: true,
          showInGraph: true,
          active: true,
          options: {
            select: {
              value: true,
              label: true,
              displayOrder: true,
              active: true
            },
            orderBy: [{ displayOrder: "asc" }, { value: "asc" }]
          }
        },
        orderBy: [{ displayOrder: "asc" }, { fieldKey: "asc" }]
      }
    },
    orderBy: [{ versionNumber: "asc" }, { id: "asc" }]
  });

  if (existingVersions.length > 0) {
    const [existingVersion] = existingVersions;
    if (
      existingVersions.length !== 1 ||
      !existingVersion ||
      !formVersionMatches(existingVersion, createdById)
    ) {
      throw new InitialFormConfigurationConflictError();
    }
    return { id: existingVersion.id };
  }

  return database.formVersion.create({
    data: {
      fieldModuleId,
      versionNumber: MOST_DATA_FORM_V1.versionNumber,
      status: FormStatus.PUBLISHED,
      publishedAt: new Date(),
      createdById,
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
    },
    select: { id: true }
  });
}

export async function seedInitialApplication(
  configuration: AdminSeedConfiguration
): Promise<{
  adminId: string;
  fieldModuleId: string;
  assignmentId: string;
  formVersionId: string;
}> {
  validateVersionedFormDefinition(MOST_DATA_FORM_V1);
  const passwordHash = await hashPassword(configuration.password);

  return prisma.$transaction(async (database) => {
    const admin = await upsertInitialAdmin(
      database,
      configuration,
      passwordHash
    );
    const fieldModule = await upsertMostDataField(database);
    const assignment = await database.userFieldAssignment.upsert({
      where: {
        userId_fieldModuleId: {
          userId: admin.id,
          fieldModuleId: fieldModule.id
        }
      },
      update: {},
      create: {
        userId: admin.id,
        fieldModuleId: fieldModule.id,
        canSubmit: false
      },
      select: { id: true }
    });
    const formVersion = await ensureInitialMostDataForm(
      database,
      fieldModule.id,
      admin.id
    );

    return {
      adminId: admin.id,
      fieldModuleId: fieldModule.id,
      assignmentId: assignment.id,
      formVersionId: formVersion.id
    };
  });
}

function isMainModule(): boolean {
  const entryPath = process.argv[1];
  return Boolean(
    entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href
  );
}

if (isMainModule()) {
  seedInitialApplication(readAdminSeedConfiguration(process.env))
    .then(() => {
      console.log("Initial application seed completed.");
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error &&
        error.message.startsWith("Invalid Admin seed configuration:")
          ? error.message
          : "Initial application seed failed.";
      console.error(message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
