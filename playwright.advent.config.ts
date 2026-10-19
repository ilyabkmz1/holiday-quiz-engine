import { defineConfig, devices } from "@playwright/test";

import { localEnv } from "./tests/e2e/support/env";

// E2E адвента: `npm run test:e2e:advent` (демо-пакет — E2E_TENANT, по умолчанию demo-coffee-advent).
// Время двигает `?asOf=`: он работает вне production и для пакетов с `demo: true`, поэтому прогон идёт и на production-сборке.
// Браузер, режим сервера и переменные — как в playwright.config.ts (E2E_BROWSER_CHANNEL, E2E_SERVER=prod, E2E_SKIP_BUILD).
const channel = process.env.E2E_BROWSER_CHANNEL ?? "chrome";
const browser = {
  ...(channel ? { channel } : {}),
  ...(process.env.E2E_BROWSER_EXECUTABLE ? { launchOptions: { executablePath: process.env.E2E_BROWSER_EXECUTABLE } } : {})
};
const appUrl = new URL(localEnv.APP_URL);
const appPort = appUrl.port || (appUrl.protocol === "https:" ? "443" : "80");
const prod = process.env.E2E_SERVER === "prod";
const tenant = process.env.E2E_TENANT ?? "demo-coffee-advent";
// Секрет QR обязателен в production для наград с погашением на кассе; здесь — тестовое значение одноразового прогона.
const serverEnv = {
  ...process.env,
  ...localEnv,
  TENANT: tenant,
  REWARD_QR_SECRET: process.env.REWARD_QR_SECRET ?? "e2e-only-qr-secret-0123456789abcdef0123456789",
  ...(prod ? { QUIZ_LOCAL_STACK: "true" } : {})
};

export default defineConfig({
  testDir: "tests/e2e-advent",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: { baseURL: localEnv.APP_URL, trace: "retain-on-failure" },
  webServer: {
    command: prod ? "node scripts/e2e-prod-server.mjs" : `npm run dev -- --hostname ${appUrl.hostname} --port ${appPort}`,
    url: localEnv.APP_URL,
    env: serverEnv,
    reuseExistingServer: !process.env.CI,
    timeout: prod ? 300_000 : 120_000
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], ...browser } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], ...browser } }
  ]
});
