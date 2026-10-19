import { afterEach, describe, expect, it, vi } from "vitest";

const createTransport = vi.fn(() => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));

const base = {
  DATABASE_URL: "postgresql://quiz:quiz@127.0.0.1:5432/quiz",
  APP_URL: "http://127.0.0.1:3000",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_FROM: "quiz@example.test",
  ADMIN_USERNAME: "operator",
  ADMIN_PASSWORD: "local-password-at-least-16"
};

async function send(extra: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  createTransport.mockClear();
  for (const [key, value] of Object.entries({ ...base, ...extra })) vi.stubEnv(key, value);
  await (await import("@/server/mailer")).sendVerificationEmail("a@example.test", "https://x.test/?token=1", "Тема письма");
  return (createTransport.mock.calls[0] as unknown as [Record<string, unknown>])[0];
}

describe("sendVerificationEmail", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("без SMTP_USER/SMTP_PASSWORD отправляет без авторизации (Mailpit)", async () => {
    expect(await send({})).not.toHaveProperty("auth");
  });

  it("с SMTP_USER/SMTP_PASSWORD передаёт авторизацию", async () => {
    expect(await send({ SMTP_USER: "u", SMTP_PASSWORD: "p" })).toMatchObject({ auth: { user: "u", pass: "p" } });
  });
});

describe("sendVerificationEmail: тема письма", () => {
  it("берёт тему из пакета арендатора", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    const sendMail = vi.fn();
    createTransport.mockReturnValue({ sendMail });
    for (const [key, value] of Object.entries(base)) vi.stubEnv(key, value);
    await (await import("@/server/mailer")).sendVerificationEmail("a@example.test", "https://x.test/?token=1", "Подтвердите участие в квизе «Кофейня»");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: "Подтвердите участие в квизе «Кофейня»" }));
    vi.unstubAllEnvs();
  });
});

describe("sendMail: шаблоны", () => {
  async function sent(run: (mailer: typeof import("@/server/mailer")) => Promise<void>) {
    vi.resetModules();
    vi.unstubAllEnvs();
    const sendMail = vi.fn();
    createTransport.mockReturnValue({ sendMail });
    for (const [key, value] of Object.entries(base)) vi.stubEnv(key, value);
    await run(await import("@/server/mailer"));
    vi.unstubAllEnvs();
    return sendMail.mock.calls[0][0] as Record<string, string>;
  }

  it("verify: текст прежний, обёртка sendVerificationEmail даёт то же письмо", async () => {
    const viaTemplate = await sent((mailer) => mailer.sendMail("verify", "a@example.test", { link: "https://x.test/?token=1", subject: "Тема" }));
    const viaWrapper = await sent((mailer) => mailer.sendVerificationEmail("a@example.test", "https://x.test/?token=1", "Тема"));
    expect(viaTemplate).toEqual(viaWrapper);
    expect(viaTemplate).toMatchObject({ to: "a@example.test", subject: "Тема", text: "Подтвердите заявку на приз: https://x.test/?token=1\n\nСсылка действует 24 часа." });
  });

  it("login: бренд, ссылка и срок в тексте, бренд в html экранируется", async () => {
    const mail = await sent((mailer) =>
      mailer.sendMail("login", "kate@example.test", { link: "https://x.test/v?token=a&b=1", subject: "Вход в «Зерно»", brandName: 'Зерно <b>"1"</b>', ttlMinutes: 30 })
    );
    expect(mail.subject).toBe("Вход в «Зерно»");
    expect(mail.text).toContain("«Зерно <b>\"1\"</b>»");
    expect(mail.text).toContain("https://x.test/v?token=a&b=1");
    expect(mail.text).toContain("30 минут");
    expect(mail.html).toContain("Зерно &lt;b&gt;&quot;1&quot;&lt;/b&gt;");
    expect(mail.html).toContain('href="https://x.test/v?token=a&amp;b=1"');
    expect(mail.html).not.toContain("<b>");
  });
});
