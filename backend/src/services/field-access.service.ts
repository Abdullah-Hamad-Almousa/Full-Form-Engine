import { prisma } from "../lib/prisma.js";

export type FieldAccessContext = {
  fieldModuleId: string;
  fieldSlug: string;
  assignmentId: string;
  canSubmit: boolean;
};

export type FieldAccessLookupResult =
  | { status: "field_not_found" }
  | { status: "field_access_forbidden" }
  | { status: "allowed"; fieldAccess: FieldAccessContext };

export async function findFieldAccess(
  userId: string,
  fieldSlug: string
): Promise<FieldAccessLookupResult> {
  const fieldModule = await prisma.fieldModule.findUnique({
    where: { slug: fieldSlug },
    select: {
      id: true,
      slug: true,
      active: true,
      assignments: {
        where: { userId },
        select: { id: true, canSubmit: true },
        take: 1
      }
    }
  });

  if (!fieldModule?.active) {
    return { status: "field_not_found" };
  }

  const [assignment] = fieldModule.assignments;
  if (!assignment) {
    return { status: "field_access_forbidden" };
  }

  return {
    status: "allowed",
    fieldAccess: {
      fieldModuleId: fieldModule.id,
      fieldSlug: fieldModule.slug,
      assignmentId: assignment.id,
      canSubmit: assignment.canSubmit
    }
  };
}
