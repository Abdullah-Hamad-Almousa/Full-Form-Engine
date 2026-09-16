import { config } from "dotenv";

config({ path: "../.env.test" });

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET ??= "test-only-session-secret-with-at-least-32-characters";
process.env.SESSION_COOKIE_SECURE = "false";

export function assertSafeTestDatabaseUrl(
  value: string,
  expectedDatabaseName = process.env.TEST_POSTGRES_DB
): void {
  const parsedUrl = new URL(value);
  const databaseName = parsedUrl.pathname.replace(/^\//, "");
  const allowedHosts = new Set(["127.0.0.1", "localhost", "database"]);

  if (!allowedHosts.has(parsedUrl.hostname)) {
    throw new Error("Refusing to use a test database on an unapproved host.");
  }
  if (!/(^|[_-])test([_-]|$)/i.test(databaseName)) {
    throw new Error("Refusing to use a database whose name is not clearly marked as test data.");
  }
  if (expectedDatabaseName && databaseName !== expectedDatabaseName) {
    throw new Error("Test database URL does not match TEST_POSTGRES_DB.");
  }
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl) {
  assertSafeTestDatabaseUrl(testDatabaseUrl);
  process.env.DATABASE_URL = testDatabaseUrl;
}
