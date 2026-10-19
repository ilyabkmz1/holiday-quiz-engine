/** Схема PostgreSQL из параметра `schema` строки подключения (как у Prisma), по умолчанию `public`. */
export function databaseSchema(url: string): string {
  return new URL(url).searchParams.get("schema") || "public";
}

/** Имя базы из строки подключения. */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/** TRUNCATE стирает все таблицы, поэтому база должна быть явно тестовой: `test_…` или `…_test`. */
export function isTestDatabaseName(name: string): boolean {
  return /^test_|_test$/i.test(name);
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
