import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = {
  DATABASE_URL: "postgresql://quiz:quiz@127.0.0.1:5432/quiz",
  APP_URL: "https://quiz.example.com",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_FROM: "quiz@example.test",
  ADMIN_USERNAME: "operator",
  ADMIN_PASSWORD: "local-password-at-least-16"
};

const verify = vi.fn();
vi.mock("@/server/container", () => ({ getServices: () => ({ claimService: { verify } }) }));

describe("GET /api/claims/verify: редирект строится от APP_URL", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    verify.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  // За прокси Next.js видит внутренний адрес контейнера, а не публичный домен.
  const proxied = (query: string) => new NextRequest(`https://0.0.0.0:3000/api/claims/verify${query}`);

  it("успех: Location ведёт на публичный APP_URL, а не на внутренний хост", async () => {
    verify.mockResolvedValue({ id: "claim-1" });
    const { GET } = await import("@/app/api/claims/verify/route");
    const response = await GET(proxied(`?token=${"a".repeat(32)}`));
    expect(response.headers.get("location")).toBe("https://quiz.example.com/verify?status=success");
  });

  it("ошибка: Location тоже ведёт на APP_URL", async () => {
    const { GET } = await import("@/app/api/claims/verify/route");
    const response = await GET(proxied(""));
    expect(response.headers.get("location")).toBe("https://quiz.example.com/verify?status=error");
  });
});
