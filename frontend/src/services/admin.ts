import { z } from "zod";

import { api } from "./api";
import {
  appendHistoryFilters,
  paginationMetaSchema,
  submissionHistoryRowSchema,
  timestampSchema,
  withSearchParams,
  workDateSchema,
  type HistoryFilters
} from "./submission-history";

const nonEmptyStringSchema = z.string().trim().min(1);
const responseValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean()
]);
const responseDataSchema = z.record(nonEmptyStringSchema, responseValueSchema);

const inputTypeSchema = z.enum([
  "DATE",
  "TIME",
  "SELECT",
  "NUMBER",
  "CHECKBOX",
  "TEXTAREA"
]);

const constraintsSchema = z
  .object({
    minValue: z.number().finite().nullable(),
    maxValue: z.number().finite().nullable(),
    decimalPlaces: z.number().int().nonnegative().nullable(),
    maxLength: z.number().int().nonnegative().nullable()
  })
  .strict();

const historicalFieldSchema = z
  .object({
    fieldKey: nonEmptyStringSchema,
    label: nonEmptyStringSchema,
    inputType: inputTypeSchema,
    required: z.boolean(),
    placeholder: z.string().nullable(),
    constraints: constraintsSchema,
    options: z.array(
      z
        .object({
          value: nonEmptyStringSchema,
          label: nonEmptyStringSchema
        })
        .strict()
    )
  })
  .strict();

const historicalRuleSchema = z
  .object({
    kind: z.literal("ALL_OR_NONE"),
    fieldKeys: z.array(nonEmptyStringSchema).min(2)
  })
  .strict();

const historicalFormSchema = z
  .object({
    formVersionId: nonEmptyStringSchema,
    versionNumber: z.number().int().positive(),
    fields: z.array(historicalFieldSchema),
    rules: z.array(historicalRuleSchema)
  })
  .strict()
  .superRefine((definition, context) => {
    const fieldKeys = new Set<string>();
    definition.fields.forEach((field, fieldIndex) => {
      if (fieldKeys.has(field.fieldKey)) {
        context.addIssue({
          code: "custom",
          path: ["fields", fieldIndex, "fieldKey"],
          message: "Historical field keys must be unique."
        });
      }
      fieldKeys.add(field.fieldKey);
      const optionValues = new Set<string>();
      field.options.forEach((option, optionIndex) => {
        if (optionValues.has(option.value)) {
          context.addIssue({
            code: "custom",
            path: ["fields", fieldIndex, "options", optionIndex, "value"],
            message: "Historical option values must be unique."
          });
        }
        optionValues.add(option.value);
      });
      if (
        field.constraints.minValue !== null &&
        field.constraints.maxValue !== null &&
        field.constraints.minValue > field.constraints.maxValue
      ) {
        context.addIssue({
          code: "custom",
          path: ["fields", fieldIndex, "constraints"],
          message: "A historical field minimum cannot exceed its maximum."
        });
      }
    });
    definition.rules.forEach((rule, ruleIndex) => {
      const ruleKeys = new Set<string>();
      rule.fieldKeys.forEach((fieldKey, fieldKeyIndex) => {
        if (!fieldKeys.has(fieldKey) || ruleKeys.has(fieldKey)) {
          context.addIssue({
            code: "custom",
            path: ["rules", ruleIndex, "fieldKeys", fieldKeyIndex],
            message: "Historical rules must reference unique returned fields."
          });
        }
        ruleKeys.add(fieldKey);
      });
    });
  });

export const adminSubmissionRowSchema = submissionHistoryRowSchema
  .extend({
    recordState: z.enum(["ACTIVE", "DELETED"]),
    deletedAt: timestampSchema.nullable()
  })
  .superRefine((row, context) => {
    if (
      (row.recordState === "ACTIVE" && row.deletedAt !== null) ||
      (row.recordState === "DELETED" && row.deletedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["deletedAt"],
        message: "Record state and deletion time must agree."
      });
    }
  });

export const adminSubmissionDetailSchema = adminSubmissionRowSchema
  .safeExtend({
    responseData: responseDataSchema,
    historicalForm: historicalFormSchema
  })
  .superRefine((detail, context) => {
    if (
      detail.historicalForm.formVersionId !== detail.formVersion.id ||
      detail.historicalForm.versionNumber !== detail.formVersion.versionNumber
    ) {
      context.addIssue({
        code: "custom",
        path: ["historicalForm"],
        message: "Historical form metadata must match the submission."
      });
    }
    const fieldsByKey = new Map(
      detail.historicalForm.fields.map((field) => [field.fieldKey, field])
    );
    for (const field of detail.historicalForm.fields) {
      const value = detail.responseData[field.fieldKey];
      if (value === undefined) {
        if (field.required) {
          context.addIssue({
            code: "custom",
            path: ["responseData", field.fieldKey],
            message: "Required canonical response values must be present."
          });
        }
        continue;
      }
      const typeMatches =
        field.inputType === "CHECKBOX"
          ? typeof value === "boolean"
          : field.inputType === "NUMBER"
            ? typeof value === "number"
            : typeof value === "string";
      if (!typeMatches) {
        context.addIssue({
          code: "custom",
          path: ["responseData", field.fieldKey],
          message: "Canonical response value type does not match the historical field."
        });
      }
      if (
        field.inputType === "SELECT" &&
        typeof value === "string" &&
        !field.options.some((option) => option.value === value)
      ) {
        context.addIssue({
          code: "custom",
          path: ["responseData", field.fieldKey],
          message: "Canonical selection must use a historical option."
        });
      }
    }
    for (const fieldKey of Object.keys(detail.responseData)) {
      if (!fieldsByKey.has(fieldKey)) {
        context.addIssue({
          code: "custom",
          path: ["responseData", fieldKey],
          message: "Canonical response data may contain only historical fields."
        });
      }
    }
    if (
      detail.responseData.workDate !== undefined &&
      (!workDateSchema.safeParse(detail.responseData.workDate).success ||
        detail.responseData.workDate !== detail.workDate)
    ) {
      context.addIssue({
        code: "custom",
        path: ["responseData", "workDate"],
        message: "Canonical work date must match submission metadata."
      });
    }
  });

const adminSubmissionCollectionSchema = z
  .object({
    data: z.array(adminSubmissionRowSchema),
    meta: paginationMetaSchema
  })
  .strict();

const adminSubmissionDetailEnvelopeSchema = z
  .object({ data: adminSubmissionDetailSchema })
  .strict();

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
);

export const auditRowSchema = z
  .object({
    id: nonEmptyStringSchema,
    action: nonEmptyStringSchema,
    entityType: nonEmptyStringSchema,
    entityId: nonEmptyStringSchema,
    field: z
      .object({
        id: nonEmptyStringSchema,
        slug: nonEmptyStringSchema,
        name: nonEmptyStringSchema
      })
      .strict()
      .nullable(),
    actor: z
      .object({
        id: nonEmptyStringSchema,
        name: nonEmptyStringSchema,
        username: nonEmptyStringSchema
      })
      .strict(),
    actorRole: z.enum(["WORKER", "MANAGER", "ADMIN"]),
    reason: z.string().nullable(),
    oldValue: jsonValueSchema.nullable(),
    newValue: jsonValueSchema.nullable(),
    createdAt: timestampSchema,
    requestId: nonEmptyStringSchema.nullable()
  })
  .strict();

const auditCollectionSchema = z
  .object({
    data: z.array(auditRowSchema),
    meta: paginationMetaSchema
  })
  .strict();

export type AdminSubmissionRow = z.infer<typeof adminSubmissionRowSchema>;
export type AdminSubmissionDetail = z.infer<
  typeof adminSubmissionDetailSchema
>;
export type AdminSubmissionCollection = z.infer<
  typeof adminSubmissionCollectionSchema
>;
export type AuditRow = z.infer<typeof auditRowSchema>;
export type AuditCollection = z.infer<typeof auditCollectionSchema>;
export type CanonicalResponseData = z.infer<typeof responseDataSchema>;

export type AdminSubmissionFilters = HistoryFilters & {
  fieldSlug?: string;
  userId?: string;
  state?: "ACTIVE" | "DELETED" | "ALL";
};

export type AuditFilters = {
  page?: number;
  pageSize?: number;
  entityType?: string;
  entityId?: string;
};

export type AdminCorrectionRequest = {
  expectedUpdatedAt: string;
  reason: string;
  responseData: CanonicalResponseData;
};

export type AdminStateChangeRequest = {
  expectedUpdatedAt: string;
  reason: string;
};

export async function listAdminSubmissions(
  filters: AdminSubmissionFilters = {},
  signal?: AbortSignal
): Promise<AdminSubmissionCollection> {
  const searchParams = new URLSearchParams();
  appendHistoryFilters(searchParams, filters);
  if (filters.fieldSlug) {
    searchParams.set("fieldSlug", filters.fieldSlug);
  }
  if (filters.userId) {
    searchParams.set("userId", filters.userId);
  }
  if (filters.state) {
    searchParams.set("state", filters.state);
  }
  const response = await api<unknown>(
    withSearchParams("/api/admin/submissions", searchParams),
    { signal, expectedStatus: 200 }
  );
  return adminSubmissionCollectionSchema.parse(response);
}

export async function getAdminSubmission(
  submissionId: string,
  signal?: AbortSignal
): Promise<AdminSubmissionDetail> {
  const response = await api<unknown>(
    `/api/admin/submissions/${encodeURIComponent(submissionId)}`,
    { signal, expectedStatus: 200 }
  );
  return adminSubmissionDetailEnvelopeSchema.parse(response).data;
}

export async function listAuditLogs(
  filters: AuditFilters = {},
  signal?: AbortSignal
): Promise<AuditCollection> {
  const searchParams = new URLSearchParams();
  if (filters.page !== undefined) {
    searchParams.set("page", String(filters.page));
  }
  if (filters.pageSize !== undefined) {
    searchParams.set("pageSize", String(filters.pageSize));
  }
  if (filters.entityType) {
    searchParams.set("entityType", filters.entityType);
  }
  if (filters.entityId) {
    searchParams.set("entityId", filters.entityId);
  }
  const response = await api<unknown>(
    withSearchParams("/api/admin/audit-logs", searchParams),
    { signal, expectedStatus: 200 }
  );
  return auditCollectionSchema.parse(response);
}

async function sendAdminMutation(
  path: string,
  method: "PATCH" | "DELETE" | "POST",
  body: AdminCorrectionRequest | AdminStateChangeRequest
): Promise<AdminSubmissionDetail> {
  const response = await api<unknown>(path, {
    method,
    body: JSON.stringify(body),
    expectedStatus: 200
  });
  return adminSubmissionDetailEnvelopeSchema.parse(response).data;
}

export async function correctAdminSubmission(
  submissionId: string,
  request: AdminCorrectionRequest
): Promise<AdminSubmissionDetail> {
  return sendAdminMutation(
    `/api/admin/submissions/${encodeURIComponent(submissionId)}`,
    "PATCH",
    {
      expectedUpdatedAt: request.expectedUpdatedAt,
      reason: request.reason,
      responseData: request.responseData
    }
  );
}

export async function deleteAdminSubmission(
  submissionId: string,
  request: AdminStateChangeRequest
): Promise<AdminSubmissionDetail> {
  return sendAdminMutation(
    `/api/admin/submissions/${encodeURIComponent(submissionId)}`,
    "DELETE",
    {
      expectedUpdatedAt: request.expectedUpdatedAt,
      reason: request.reason
    }
  );
}

export async function restoreAdminSubmission(
  submissionId: string,
  request: AdminStateChangeRequest
): Promise<AdminSubmissionDetail> {
  return sendAdminMutation(
    `/api/admin/submissions/${encodeURIComponent(submissionId)}/restorations`,
    "POST",
    {
      expectedUpdatedAt: request.expectedUpdatedAt,
      reason: request.reason
    }
  );
}
