import { describe, expect, it } from "vitest";

describe("frontend test environment", () => {
  it("runs the Phase 0 smoke suite", () => {
    expect("field-app").toContain("field");
  });
});
