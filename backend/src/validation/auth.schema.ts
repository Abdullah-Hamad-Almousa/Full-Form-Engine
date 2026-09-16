import { z } from "zod";

import { ApplicationError } from "../middleware/error-handler.js";

const loginCredentialsSchema = z
  .object({
    username: z
      .string({ error: "Enter a username." })
      .trim()
      .min(1, "Enter a username.")
      .max(100, "Username is too long."),
    password: z
      .string({ error: "Enter a password." })
      .min(1, "Enter a password.")
      .max(1024, "Password is too long.")
  })
  .strict();

export type LoginCredentials = z.infer<typeof loginCredentialsSchema>;

export function parseLoginCredentials(input: unknown): LoginCredentials {
  const result = loginCredentialsSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    const key = typeof field === "string" ? field : "request";
    fields[key] ??= issue.message;
  }

  throw new ApplicationError({
    status: 422,
    code: "VALIDATION_FAILED",
    message: "Check the provided credentials and try again.",
    fields
  });
}
