import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.warn(
    "\n[integration] TEST_DATABASE_URL не задан — интеграционные тесты ПРОПУЩЕНЫ.\n" +
      "[integration] Пример: TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/quiz_test npm run test:integration\n"
  );
}

export default defineConfig({
  test: {
    environment: "node",
    include: testDatabaseUrl ? ["tests/integration/**/*.test.ts"] : [],
    passWithNoTests: !testDatabaseUrl,
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    // Все файлы делят одну БД и очищают её между тестами — только последовательно.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000
  },
  resolve: {
    alias: {
      "@worlds": fileURLToPath(new URL("./worlds", import.meta.url)),
      "@profiles": fileURLToPath(new URL("./profiles", import.meta.url)),
      "@facades": fileURLToPath(new URL("./facades", import.meta.url)),
      "@tenants": fileURLToPath(new URL("./tenants", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
