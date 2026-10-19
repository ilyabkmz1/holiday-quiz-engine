// Тестовые значения для локального и CI-запуска. Это не секреты: БД, SMTP и
// администратор существуют только внутри одноразового окружения прогона.
// Любое значение можно переопределить переменной окружения с тем же именем.
const env = process.env;

export const localEnv = {
  DATABASE_URL: env.DATABASE_URL ?? "postgresql://quiz:quiz@127.0.0.1:5432/quiz?schema=public",
  APP_URL: env.APP_URL ?? "http://127.0.0.1:3000",
  // В образе несколько пакетов: сервер e2e поднимается на арендаторе прогона (E2E_TENANT, по умолчанию эталонный demo-office).
  TENANT: env.TENANT ?? env.E2E_TENANT ?? "demo-office",
  SMTP_HOST: env.SMTP_HOST ?? "127.0.0.1",
  SMTP_PORT: env.SMTP_PORT ?? "1025",
  SMTP_FROM: env.SMTP_FROM ?? "quiz@example.test",
  ADMIN_USERNAME: env.ADMIN_USERNAME ?? "operator",
  ADMIN_PASSWORD: env.ADMIN_PASSWORD ?? "local-password-at-least-16",
  // Без открытого квиза и окон заявки E2E не работают, поэтому флаг не переопределяется.
  QUIZ_FORCE_OPEN: "true"
};

export const mailpitUrl = env.MAILPIT_URL ?? "http://127.0.0.1:8025";
