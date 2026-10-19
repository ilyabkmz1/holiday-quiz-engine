import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { databaseName, isTestDatabaseName } from "./helpers/database";

export default function globalSetup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;

  // TRUNCATE между тестами уничтожает данные — работаем только с базой, явно названной тестовой.
  const name = databaseName(url);
  if (!isTestDatabaseName(name)) {
    throw new Error(
      `TEST_DATABASE_URL указывает на базу "${name}". Имя тестовой базы должно начинаться с "test_" или оканчиваться на "_test": ` +
        "интеграционные тесты очищают все таблицы."
    );
  }

  const env = { ...process.env, DATABASE_URL: url };
  if (!existsSync("src/generated/prisma/client.ts")) {
    execFileSync("npx", ["prisma", "generate"], { stdio: "inherit", env });
  }
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env });
}
