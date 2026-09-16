import { prisma } from "../lib/prisma.js";

export type FieldDescriptor = {
  name: string;
  slug: string;
  description: string | null;
  route: string;
  canSubmit: boolean;
};

function createFieldRoute(slug: string): string {
  return `/fields/${encodeURIComponent(slug)}`;
}

export async function listAssignedFields(
  userId: string
): Promise<FieldDescriptor[]> {
  const assignments = await prisma.userFieldAssignment.findMany({
    where: {
      userId,
      fieldModule: { active: true }
    },
    select: {
      canSubmit: true,
      fieldModule: {
        select: {
          name: true,
          slug: true,
          description: true
        }
      }
    },
    orderBy: [
      { fieldModule: { displayOrder: "asc" } },
      { fieldModule: { name: "asc" } },
      { fieldModule: { slug: "asc" } }
    ]
  });

  return assignments.map(({ canSubmit, fieldModule }) => ({
    name: fieldModule.name,
    slug: fieldModule.slug,
    description: fieldModule.description,
    route: createFieldRoute(fieldModule.slug),
    canSubmit
  }));
}

export async function findActiveFieldDescriptor(
  fieldModuleId: string,
  canSubmit: boolean
): Promise<FieldDescriptor | null> {
  const fieldModule = await prisma.fieldModule.findFirst({
    where: { id: fieldModuleId, active: true },
    select: {
      name: true,
      slug: true,
      description: true
    }
  });

  if (!fieldModule) {
    return null;
  }

  return {
    name: fieldModule.name,
    slug: fieldModule.slug,
    description: fieldModule.description,
    route: createFieldRoute(fieldModule.slug),
    canSubmit
  };
}
