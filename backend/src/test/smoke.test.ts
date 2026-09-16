import { describe, expect, it } from "vitest";
import { assertSafeTestDatabaseUrl } from "./setup.js";

describe("backend test environment", () => {
  it("uses test mode", () => {
    expect(process.env.NODE_ENV).toBe("test");
  });

  it("rejects a non-test database target", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://user:password@127.0.0.1:5432/field_app"
      )
    ).toThrow(/test data/);
  });

  it("rejects an unapproved database host", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://user:password@production-db:5432/field_app_test",
        "field_app_test"
      )
    ).toThrow(/unapproved host/);
  });

  it("rejects a URL whose database differs from TEST_POSTGRES_DB", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://user:password@127.0.0.1:5432/other_test",
        "field_app_test"
      )
    ).toThrow(/does not match/);
  });
});
