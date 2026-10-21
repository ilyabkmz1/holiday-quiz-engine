import { afterAll, afterEach, beforeEach, expect, vi } from "vitest";
import pg from "pg";

import { clearAnalyticsCache } from "@/server/advent-report";
import { clearLeaderboardCache } from "@/server/advent-metrics";
import { resetServiceOverrides } from "@/server/container";
import { resetRuntimeEnvCache } from "@/server/env";
import {
  adminAuthRateLimiter,
  adventParticipantRateLimiter,
  identityRequestEmailRateLimiter,
  identityRequestIpRateLimiter,
  identityRequestParticipantRateLimiter,
  publicApiRateLimiter,
  sessionCreationRateLimiter,
  shareRateLimiter
} from "@/server/rate-limit";

import { databaseSchema, quoteIdentifier } from "./helpers/database";
import { TEST_ADMIN_PASSWORD, TEST_ADMIN_USERNAME, TEST_APP_URL } from "./helpers/constants";
import { consoleLog, sensitiveValues } from "./helpers/leak-guard";

const databaseUrl = process.env.TEST_DATABASE_URL;

// Окружение приложения задаётся до первого обращения к getRuntimeEnv().
if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_URL = TEST_APP_URL;
  process.env.SMTP_HOST = "smtp.invalid";
  process.env.SMTP_PORT = "1";
  process.env.SMTP_SECURE = "false";
  process.env.SMTP_FROM = "Quiz <quiz@quiz.test>";
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
  // Администратор из окружения в многоарендном режиме действует только явно (src/server/admin-auth.ts); тесты изоляции его выключают.
  process.env.SUPERADMIN = "true";
  delete process.env.QUIZ_FORCE_OPEN;
  sensitiveValues.add(TEST_ADMIN_PASSWORD);
}

const client = databaseUrl ? new pg.Client({ connectionString: databaseUrl }) : null;
let connected = false;

async function truncateAll(): Promise<void> {
  if (!client) return;
  if (!connected) {
    await client.connect();
    connected = true;
  }
  // Очищаем ту же схему, в которую Prisma применила миграции (параметр schema в TEST_DATABASE_URL).
  const schema = databaseSchema(databaseUrl!);
  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename <> '_prisma_migrations'",
    [schema]
  );
  if (rows.length) {
    const tables = rows.map((row) => `${quoteIdentifier(schema)}.${quoteIdentifier(row.tablename)}`).join(", ");
    await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  }
}

beforeEach(async () => {
  await truncateAll();
  resetServiceOverrides();
  resetRuntimeEnvCache();
  clearAnalyticsCache();
  clearLeaderboardCache();
  publicApiRateLimiter.reset();
  publicApiRateLimiter.setLimit(600);
  sessionCreationRateLimiter.reset();
  shareRateLimiter.reset();
  adventParticipantRateLimiter.reset();
  identityRequestEmailRateLimiter.reset();
  identityRequestIpRateLimiter.reset();
  identityRequestParticipantRateLimiter.reset();
  adminAuthRateLimiter.reset();
  consoleLog.start();
});

afterEach(() => {
  const output = consoleLog.stop();
  vi.unstubAllEnvs();
  try {
    // Инвариант: email, токены, поля формы и пароль администратора не попадают в console.*.
    for (const value of sensitiveValues) {
      expect(output, `console.* содержит чувствительное значение (${value.length} симв.)`).not.toContain(value);
    }
  } finally {
    // Иначе после упавшей проверки значения этого теста валили бы следующие.
    sensitiveValues.clear();
    sensitiveValues.add(TEST_ADMIN_PASSWORD);
  }
});

afterAll(async () => {
  if (client && connected) {
    await client.end();
  }
});
