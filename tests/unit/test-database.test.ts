import { describe, expect, it } from "vitest";

import { databaseName, databaseSchema, isTestDatabaseName } from "../integration/helpers/database";

describe("integration test database guard", () => {
  it.each(["quiz_test", "test_quiz", "QUIZ_TEST", "test_"])("accepts %s", (name) => {
    expect(isTestDatabaseName(name)).toBe(true);
  });

  it.each(["quiz", "contest", "attestation", "quiz_test_copy", "testquiz", "latest"])("rejects %s", (name) => {
    expect(isTestDatabaseName(name)).toBe(false);
  });

  it("reads the database name and the Prisma schema parameter", () => {
    expect(databaseName("postgresql://u:p@127.0.0.1:5432/quiz_test?schema=itest")).toBe("quiz_test");
    expect(databaseSchema("postgresql://u:p@127.0.0.1:5432/quiz_test?schema=itest")).toBe("itest");
    expect(databaseSchema("postgresql://u:p@127.0.0.1:5432/quiz_test")).toBe("public");
  });
});
