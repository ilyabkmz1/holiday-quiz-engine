import { defineConfig, devices } from "@playwright/test";

import { localEnv } from "./tests/e2e/support/env";

// Локально по умолчанию используется установленный Google Chrome.
// E2E_BROWSER_CHANNEL="" включает встроенный Chromium Playwright (так работает CI),
// E2E_BROWSER_EXECUTABLE указывает на конкретный бинарник браузера.
const channel = process.env.E2E_BROWSER_CHANNEL ?? "chrome";
const browser = {
  ...(channel ? { channel } : {}),
  ...(process.env.E2E_BROWSER_EXECUTABLE
    ? { launchOptions: { executablePath: process.env.E2E_BROWSER_EXECUTABLE } }
    : {})
};
// Dev-сервер слушает адрес из APP_URL, чтобы Origin-проверка совпадала с baseURL.
const appUrl = new URL(localEnv.APP_URL);
const appPort = appUrl.port || (appUrl.protocol === "https:" ? "443" : "80");

// E2E_SERVER=prod гоняет тесты против production-сборки (standalone server.js, как в Docker):
// её поведение отличается от next dev (NODE_ENV=production, оптимизации, нет dev-оверлея).
// Без переменной остаётся dev-сервер. Для prod QUIZ_LOCAL_STACK обязателен: без него
// приложение отказывается открывать кампанию флагом QUIZ_FORCE_OPEN в production.
const prod = process.env.E2E_SERVER === "prod";
const serverEnv = { ...process.env, ...localEnv, ...(prod ? { QUIZ_LOCAL_STACK: "true" } : {}) };

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  // Dev-сервер компилирует маршруты при первом обращении, поэтому таймауты щедрее дефолтных.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: { baseURL: localEnv.APP_URL, trace: "retain-on-failure" },
  webServer: {
    command: prod
      ? "node scripts/e2e-prod-server.mjs"
      : `npm run dev -- --hostname ${appUrl.hostname} --port ${appPort}`,
    url: localEnv.APP_URL,
    env: serverEnv,
    reuseExistingServer: !process.env.CI,
    // В prod-режиме в лимит входит сборка, если она не вынесена в отдельный шаг (E2E_SKIP_BUILD=1).
    timeout: prod ? 300_000 : 120_000
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], ...browser } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], ...browser } }
  ]
});
