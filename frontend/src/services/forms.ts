import { z } from "zod";

import { api } from "./api";

const inputTypeSchema = z.enum([
  "DATE",
  "TIME",
  "SELECT",
  "NUMBER",
  "CHECKBOX",
  "TEXTAREA"
]);

const formConstraintsSchema = z
  .object({
    minValue: z.number().finite().nullable(),
    maxValue: z.number().finite().nullable(),
    decimalPlaces: z.number().int().nonnegative().nullable(),
    maxLength: z.number().int().nonnegative().nullable()
  })
  .strict();

const fieldOptionSchema = z
  .object({
    value: z.string().min(1),
    label: z.string().min(1)
  })
  .strict();

const formFieldSchema = z
  .object({
    fieldKey: z.string().min(1),
    label: z.string().min(1),
    inputType: inputTypeSchema,
    required: z.boolean(),
    placeholder: z.string().nullable(),
    constraints: formConstraintsSchema,
    options: z.array(fieldOptionSchema)
  })
  .strict();

const allOrNoneRuleSchema = z
  .object({
    kind: z.literal("ALL_OR_NONE"),
    fieldKeys: z.array(z.string().min(1)).min(2)
  })
  .strict();

const formDefinitionSchema = z
  .object({
    formVersionId: z.string().min(1),
    versionNumber: z.number().int().positive(),
    fields: z.array(formFieldSchema),
    rules: z.array(allOrNoneRuleSchema)
  })
  .strict()
  .superRefine((definition, context) => {
    const fieldKeys = new Set<string>();

    definition.fields.forEach((field, fieldIndex) => {
      if (fieldKeys.has(field.fieldKey)) {
        context.addIssue({
          code: "custom",
          path: ["fields", fieldIndex, "fieldKey"],
          message: "Form field keys must be unique."
        });
      }
      fieldKeys.add(field.fieldKey);

      const optionValues = new Set<string>();
      field.options.forEach((option, optionIndex) => {
        if (optionValues.has(option.value)) {
          context.addIssue({
            code: "custom",
            path: ["fields", fieldIndex, "options", optionIndex, "value"],
            message: "Field option values must be unique."
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
          message: "A field minimum cannot exceed its maximum."
        });
      }
    });

    definition.rules.forEach((rule, ruleIndex) => {
      const ruleFieldKeys = new Set<string>();
      rule.fieldKeys.forEach((fieldKey, fieldKeyIndex) => {
        if (!fieldKeys.has(fieldKey)) {
          context.addIssue({
            code: "custom",
            path: ["rules", ruleIndex, "fieldKeys", fieldKeyIndex],
            message: "Form rules may reference only returned fields."
          });
        }
        if (ruleFieldKeys.has(fieldKey)) {
          context.addIssue({
            code: "custom",
            path: ["rules", ruleIndex, "fieldKeys", fieldKeyIndex],
            message: "Form rule field keys must be unique."
          });
        }
        ruleFieldKeys.add(fieldKey);
      });
    });
  });

const formDefinitionEnvelopeSchema = z
  .object({
    data: formDefinitionSchema
  })
  .strict();

export type FormInputType = z.infer<typeof inputTypeSchema>;
export type FormConstraints = z.infer<typeof formConstraintsSchema>;
export type FormField = z.infer<typeof formFieldSchema>;
export type FormRule = z.infer<typeof allOrNoneRuleSchema>;
export type FormDefinition = z.infer<typeof formDefinitionSchema>;

export async function getFieldForm(
  fieldSlug: string,
  signal?: AbortSignal
): Promise<FormDefinition> {
  const response = await api<unknown>(
    `/api/fields/${encodeURIComponent(fieldSlug)}/form`,
    { signal }
  );
  return formDefinitionEnvelopeSchema.parse(response).data;
}
