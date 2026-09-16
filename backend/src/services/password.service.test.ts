import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.service.js";

describe("password service", () => {
  it("hashes with Argon2id and verifies only the matching password", async () => {
    const password = "phase1-password-service-test";
    const passwordHash = await hashPassword(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).not.toContain(password);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(
      verifyPassword(passwordHash, "different-password")
    ).resolves.toBe(false);
  });
});
