import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { packSchema } from "@/config/pack";
import type { ReminderMailVars } from "@/server/mail-reminder";

import { adventPackFixture } from "../fixtures/advent";
import { at } from "../support/advent";
import { smallCampaign } from "../support/small-campaign";

const env = {
  DATABASE_URL: "postgresql://quiz:quiz@127.0.0.1:5432/quiz",
  APP_URL: "https://advent.test",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_FROM: "quiz@example.test",
  ADMIN_USERNAME: "operator",
  ADMIN_PASSWORD: "local-password-at-least-16"
};

const world = vi.hoisted(() => ({
  now: new Date(),
  sent: [] as Array<{ email: string; vars: unknown }>,
  login: [] as string[],
  /** Кому ушли ссылки входа и с какими параметрами. */
  loginMail: [] as Array<{ email: string; link: URL }>,
  build: null as null | ((tenant: unknown) => unknown),
  repository: null as unknown
}));

vi.mock("@/server/container", () => ({
  getNow: () => new Date(world.now),
  getServices: () => {
    throw new Error("квиз-сервисы в этом тесте не нужны");
  },
  getAdventServices: (tenant: unknown) => world.build!(tenant)
}));

const HOST = "advent.test";
async function boot() {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("NODE_ENV", "test");
  const { InMemoryAdventRepository } = await import("@/server/repositories/in-memory-advent-repository");
  const { AdventService } = await import("@/server/services/advent-service");
  const { IdentityService } = await import("@/server/services/identity-service");
  const { ReminderService, DEFAULT_REMINDER_OPTIONS } = await import("@/server/services/reminder-service");
  const { RewardService } = await import("@/server/services/reward-service");
  const repository = new InMemoryAdventRepository();
  world.repository = repository;
  world.sent.length = 0;
  world.login.length = 0;
  world.loginMail.length = 0;
  world.now = at(3, 12);
  world.build = (tenant) => {
    const config = (tenant as { advent: import("@/config/advent-schema").AdventConfig }).advent;
    const rewardService = new RewardService(repository, config, { qrSecret: "route-test-reward-qr-secret-0123456789abcdef" });
    const adventService = new AdventService(repository, config, rewardService);
    return {
      prisma: { campaign: { upsert: async () => undefined } },
      ensureCampaign: async () => undefined,
      repository,
      adventService,
      rewardService,
      reminderService: new ReminderService({
        repository,
        advent: config,
        baseUrl: "https://advent.test",
        options: { ...DEFAULT_REMINDER_OPTIONS, ratePerSecond: 0 },
        send: async (email, vars: ReminderMailVars) => {
          world.sent.push({ email, vars });
        }
      }),
      identityService: new IdentityService({
        repository,
        advent: config,
        onVerified: (participantId, now) => adventService.ensureCodes(participantId, now),
        verifyEndpoint: "https://advent.test/api/advent/identity/verify",
        sendLoginLink: async (email, link) => {
          world.login.push(new URL(link).searchParams.get("token")!);
          world.loginMail.push({ email, link: new URL(link) });
        }
      })
    };
  };
  const tenants = await import("@/server/tenants");
  const quizPack = packSchema.parse({ tenant: "quiz", hosts: ["quiz.test"], campaign: smallCampaign("quiz-campaign") });
  tenants.overrideTenants(tenants.loadTenants([{ ...adventPackFixture(), hosts: [HOST], demo: false }, quizPack]));
  const api = await import("@/server/advent-api");
  const build = world.build;
  return {
    ADVENT_COOKIE: api.ADVENT_COOKIE,
    repository,
    services: () => build(tenants.findTenant(HOST)) as ReturnType<typeof build> & Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
    participants: (await import("@/app/api/advent/participants/route")).POST,
    identityRequest: (await import("@/app/api/advent/identity/request/route")).POST,
    identityConfirm: (await import("@/app/api/advent/identity/verify/route")).POST,
    reminders: (await import("@/app/api/advent/reminders/route")).POST,
    open: (await import("@/app/api/advent/reminders/open/route")).GET,
    reminderLogin: (await import("@/app/api/advent/reminders/login/route")).POST,
    state: (await import("@/app/api/advent/state/route")).GET,
    unsubscribe: (await import("@/app/api/advent/unsubscribe/route")).POST,
    oneClick: (await import("@/app/api/advent/unsubscribe/one-click/route")).POST,
    oneClickGet: (await import("@/app/api/advent/unsubscribe/one-click/route")).GET
  };
}

type App = Awaited<ReturnType<typeof boot>>;
type Init = { method?: string; host?: string; cookie?: string | null; origin?: string | null; body?: unknown; form?: Record<string, string>; headers?: Record<string, string> };

function request(path: string, init: Init = {}): NextRequest {
  const host = init.host ?? HOST;
  const method = init.method ?? "GET";
  const headers = new Headers({ host, ...init.headers });
  const origin = init.origin === undefined ? (method === "GET" ? null : `https://${host}`) : init.origin;
  if (origin) headers.set("origin", origin);
  if (init.cookie) headers.set("cookie", `advent_participant_access=${init.cookie}`);
  let body: string | undefined;
  if (init.form) {
    headers.set("content-type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(init.form).toString();
  } else if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  return new NextRequest(new URL(path, `https://${host}`), { method, headers, body });
}

const json = (response: Response) => response.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const location = (response: Response) => new URL(response.headers.get("location")!);

/** Участник с подтверждённым email и напоминаниями; возвращает cookie устройства, на котором он вошёл. */
async function subscriber(app: App, email = "kate@example.test", optIn = true) {
  const created = await app.participants(request("/api/advent/participants", { method: "POST" }));
  const anon = created.cookies.get(app.ADVENT_COOKIE)!.value;
  await app.identityRequest(request("/api/advent/identity/request", { method: "POST", cookie: anon, body: { email, consent: true, marketingConsent: optIn, reminderOptIn: optIn } }));
  const confirmed = await app.identityConfirm(request("/api/advent/identity/verify", { method: "POST", cookie: anon, form: { token: world.login.at(-1)! } }));
  return { cookie: confirmed.cookies.get(app.ADVENT_COOKIE)!.value, participantId: (await json(created)).participantId as string };
}

/** Запускает рассылку и возвращает последнее письмо. */
async function remind(app: App, now = at(3, 9)) {
  world.now = now;
  const result = await app.services().reminderService.run(now);
  return { result, mail: world.sent.at(-1)?.vars as ReminderMailVars | undefined };
}

describe("маршруты напоминаний", () => {
  const logs: string[] = [];
  beforeEach(() => {
    logs.length = 0;
    for (const method of ["info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("POST /api/advent/reminders (переключатель на сайте)", () => {
    it("без cookie — 401, анониму без email — 409, чужой Origin — 403, не boolean и включение без согласия на рассылку — 400", async () => {
      const app = await boot();
      const on = { enabled: true, marketingConsent: true };
      expect((await app.reminders(request("/api/advent/reminders", { method: "POST", body: on }))).status).toBe(401);
      const created = await app.participants(request("/api/advent/participants", { method: "POST" }));
      const cookie = created.cookies.get(app.ADVENT_COOKIE)!.value;
      expect((await app.reminders(request("/api/advent/reminders", { method: "POST", cookie, body: { enabled: true } }))).status).toBe(400);
      expect((await app.reminders(request("/api/advent/reminders", { method: "POST", cookie, body: { enabled: true, marketingConsent: false } }))).status).toBe(400);
      const anonymous = await app.reminders(request("/api/advent/reminders", { method: "POST", cookie, body: on }));
      expect(anonymous.status).toBe(409);
      expect((await json(anonymous)).error).toMatch(/email/);
      expect((await app.reminders(request("/api/advent/reminders", { method: "POST", cookie, origin: "https://evil.example", body: on }))).status).toBe(403);
      expect((await app.reminders(request("/api/advent/reminders", { method: "POST", cookie, body: { enabled: "да" } }))).status).toBe(400);
      expect((await app.reminders(request("/api/advent/reminders", { method: "POST", cookie, body: {} }))).status).toBe(400);
    });

    it("подтверждённый участник включает (с согласием на рассылку) и выключает (отзыв) напоминания; повтор идемпотентен; согласие на данные остаётся", async () => {
      const app = await boot();
      const { cookie, participantId } = await subscriber(app, "kate@example.test", false);
      expect(await app.repository.getParticipant(participantId)).toMatchObject({ reminderOptIn: false, marketingConsentAt: null });
      const call = async (enabled: boolean) => {
        const response = await app.reminders(request("/api/advent/reminders", { method: "POST", cookie, body: { enabled, marketingConsent: enabled } }));
        expect(response.status).toBe(200);
        return (await json(response)).state.participant;
      };

      expect(await call(true)).toMatchObject({ reminderOptIn: true, marketingConsent: true, canRemind: true, consent: true });
      expect(await app.repository.getParticipant(participantId)).toMatchObject({ marketingConsentAt: world.now });
      expect(await call(true)).toMatchObject({ reminderOptIn: true });
      expect(await call(false)).toMatchObject({ reminderOptIn: false, marketingConsent: false, consent: true, email: "k***@example.test" });
      expect(await call(false)).toMatchObject({ reminderOptIn: false });
      const record = await app.repository.getParticipant(participantId);
      expect(record).toMatchObject({ reminderOptIn: false, consentAt: expect.any(Date), marketingConsentAt: null, unsubscribedAt: world.now });
      expect(logs.join("\n")).not.toContain("kate@example.test");
    });

    it("в кампании без рассылки (channel off) — 409", async () => {
      const app = await boot();
      const { cookie } = await subscriber(app);
      const tenants = await import("@/server/tenants");
      const off = adventPackFixture();
      off.advent.reminders.channel = "off";
      tenants.overrideTenants(tenants.loadTenants([{ ...off, hosts: [HOST], demo: false }]));
      const response = await app.reminders(request("/api/advent/reminders", { method: "POST", cookie, body: { enabled: true, marketingConsent: true } }));
      expect(response.status).toBe(409);
    });
  });

  describe("кнопка письма: вход только по cookie, иначе — свежая ссылка на адрес владельца", () => {
    const sendLink = (app: App, form: Record<string, string>, init: Init = {}) => app.reminderLogin(request("/api/advent/reminders/login", { method: "POST", form, ...init }));

    it("полный путь без cookie: страница «войдите» → «Прислать ссылку» → письмо владельцу → вход → сайт на дне письма", async () => {
      const app = await boot();
      const { participantId, cookie: ownerCookie } = await subscriber(app);
      const { result, mail } = await remind(app);
      expect(result).toMatchObject({ sent: 1, day: 3 });

      const button = new URL(mail!.link);
      expect([...button.searchParams.keys()]).toEqual(["r"]);
      const deliveryId = button.searchParams.get("r")!;
      const loginsBefore = world.loginMail.length;
      const first = await app.open(request(`${button.pathname}${button.search}`));
      expect(first.status).toBe(303);
      const page = location(first);
      expect(page.pathname).toBe("/reminder");
      expect(Object.fromEntries(page.searchParams)).toEqual({ r: deliveryId, d: "3" });
      // GET (его делают и почтовые сканеры) ничего не тратит, не шлёт и клик не засчитывает.
      expect((await app.repository.getReminderDelivery(deliveryId))?.clickedAt).toBeNull();
      expect(world.loginMail).toHaveLength(loginsBefore);
      expect(first.cookies.get(app.ADVENT_COOKIE)).toBeUndefined();

      const asked = await sendLink(app, { r: deliveryId });
      expect(asked.status).toBe(303);
      expect(location(asked).pathname + location(asked).search).toBe("/reminder?sent=1");
      expect(asked.headers.get("location")).not.toContain("kate");
      expect(world.loginMail).toHaveLength(loginsBefore + 1);
      const letter = world.loginMail.at(-1)!;
      expect(letter.email).toBe("kate@example.test");
      expect(letter.link.searchParams.get("r")).toBe(deliveryId);
      expect((await app.repository.getReminderDelivery(deliveryId))?.clickedAt).toEqual(world.now);
      const device = asked.cookies.get(app.ADVENT_COOKIE)!.value;
      // У запросившего устройства пока только свой анонимный участник.
      expect((await json(await app.state(request("/api/advent/state", { cookie: device })))).participant).toMatchObject({ email: null });

      const confirmed = await app.identityConfirm(request("/api/advent/identity/verify", { method: "POST", cookie: device, form: { token: letter.link.searchParams.get("token")!, r: deliveryId } }));
      expect(location(confirmed).pathname + location(confirmed).search).toBe("/?day=3");
      const cookie = confirmed.cookies.get(app.ADVENT_COOKIE)!.value;
      const { hashToken } = await import("@/server/crypto");
      expect((await app.repository.findParticipantByAccessKeyHash(hashToken(cookie)))?.id).toBe(participantId);
      // Ключ прежнего устройства владельца не отозван.
      expect((await app.repository.findParticipantByAccessKeyHash(hashToken(ownerCookie)))?.id).toBe(participantId);
    });

    it("с cookie того же участника сразу на сайт и переход засчитывается; повторный переход первый не затирает", async () => {
      const app = await boot();
      const { cookie } = await subscriber(app);
      const { mail } = await remind(app);
      const button = new URL(mail!.link);
      const response = await app.open(request(`${button.pathname}${button.search}`, { cookie }));
      expect(location(response).pathname + location(response).search).toBe("/?day=3");
      expect((await app.repository.getReminderDelivery(button.searchParams.get("r")!))?.clickedAt).toEqual(at(3, 9));
      world.now = at(3, 13);
      await app.open(request(`${button.pathname}${button.search}`, { cookie }));
      expect((await app.repository.getReminderDelivery(button.searchParams.get("r")!))?.clickedAt).toEqual(at(3, 9));
      // Кнопка «Прислать ссылку» на устройстве, где владелец уже вошёл, письма не шлёт.
      const before = world.loginMail.length;
      const already = await sendLink(app, { r: button.searchParams.get("r")! }, { cookie });
      expect(location(already).pathname + location(already).search).toBe("/?day=3");
      expect(world.loginMail).toHaveLength(before);
    });

    it("пересланное письмо: cookie другого участника — страница «войдите», ссылка уходит владельцу, а не пересылавшему; чужая доставка при входе дня не открывает", async () => {
      const app = await boot();
      await subscriber(app, "kate@example.test");
      const { cookie: other } = await subscriber(app, "oleg@example.test", false);
      const { mail } = await remind(app);
      const button = new URL(mail!.link);
      const deliveryId = button.searchParams.get("r")!;
      const response = await app.open(request(`${button.pathname}${button.search}`, { cookie: other }));
      expect(location(response).pathname).toBe("/reminder");
      expect((await app.repository.getReminderDelivery(deliveryId))?.clickedAt).toBeNull();

      const asked = await sendLink(app, { r: deliveryId }, { cookie: other });
      expect(location(asked).search).toBe("?sent=1");
      expect(asked.cookies.get(app.ADVENT_COOKIE)).toBeUndefined();
      expect(world.loginMail.at(-1)!.email).toBe("kate@example.test");

      // Олег подставляет в форму входа чужую доставку со своей ссылкой: вход его, день письма не открывается.
      await app.identityRequest(request("/api/advent/identity/request", { method: "POST", cookie: other, body: { email: "oleg@example.test", consent: true } }));
      const confirmed = await app.identityConfirm(request("/api/advent/identity/verify", { method: "POST", cookie: other, form: { token: world.login.at(-1)!, r: deliveryId } }));
      expect(location(confirmed).pathname + location(confirmed).search).toBe("/");
    });

    it("«Прислать ссылку»: без Origin или с чужим — 403; мусор — страница ошибки; неизвестная доставка — тот же ответ без письма", async () => {
      const app = await boot();
      await subscriber(app);
      const { mail } = await remind(app);
      const deliveryId = new URL(mail!.link).searchParams.get("r")!;
      const before = world.loginMail.length;
      expect((await sendLink(app, { r: deliveryId }, { origin: null })).status).toBe(403);
      expect((await sendLink(app, { r: deliveryId }, { origin: "https://evil.example" })).status).toBe(403);
      expect(location(await sendLink(app, { r: "не-uuid" })).pathname + location(await sendLink(app, {})).search).toBe("/reminder");
      expect(location(await sendLink(app, { r: "00000000-0000-4000-8000-000000000000" })).search).toBe("?sent=1");
      // Email страница не принимает: поле игнорируется, письмо уходит только владельцу доставки.
      await sendLink(app, { r: deliveryId, email: "attacker@example.test" });
      expect(world.loginMail.slice(before).map((item) => item.email)).toEqual(["kate@example.test"]);
    });

    it("лимиты: не больше 3 ссылок с одной кнопки письма за 15 минут", async () => {
      const app = await boot();
      await subscriber(app);
      const { mail } = await remind(app);
      const deliveryId = new URL(mail!.link).searchParams.get("r")!;
      const before = world.loginMail.length;
      const results: string[] = [];
      for (let index = 0; index < 4; index += 1) results.push(location(await sendLink(app, { r: deliveryId }, { headers: { "x-forwarded-for": `10.0.0.${index}` } })).search);
      expect(results.slice(0, 3)).toEqual(["?sent=1", "?sent=1", "?sent=1"]);
      expect(results[3]).toBe(`?r=${deliveryId}&limited=1`);
      expect(world.loginMail.length - before).toBe(3);
    });

    it("неизвестная доставка и мусор в кнопке ведут на главную", async () => {
      const app = await boot();
      for (const query of ["", "?r=не-uuid", "?r=00000000-0000-4000-8000-000000000000"]) {
        const response = await app.open(request(`/api/advent/reminders/open${query}`));
        expect(response.status).toBe(303);
        expect(location(response).pathname + location(response).search).toBe("/");
      }
    });

    it("на квиз-арендаторе маршрутов напоминаний нет — 404", async () => {
      const app = await boot();
      expect((await app.open(request("/api/advent/reminders/open", { host: "quiz.test" }))).status).toBe(404);
      expect((await app.unsubscribe(request("/api/advent/unsubscribe", { method: "POST", host: "quiz.test", form: { t: "x".repeat(30) } }))).status).toBe(404);
      expect((await app.oneClick(request("/api/advent/unsubscribe/one-click?t=" + "x".repeat(30), { method: "POST", host: "quiz.test", origin: null }))).status).toBe(404);
    });
  });

  describe("отписка", () => {
    async function withMail() {
      const app = await boot();
      const person = await subscriber(app);
      const { mail } = await remind(app);
      return { app, ...person, mail: mail!, token: new URL(mail!.unsubscribeUrl).searchParams.get("t")! };
    }

    it("форма страницы: POST с Origin отключает напоминания и ведёт на /unsubscribe?done=1 без токена в адресе; повтор идемпотентен", async () => {
      const { app, token, participantId } = await withMail();
      const response = await app.unsubscribe(request("/api/advent/unsubscribe", { method: "POST", form: { t: token } }));
      expect(response.status).toBe(303);
      expect(location(response).pathname + location(response).search).toBe("/unsubscribe?done=1");
      const record = await app.repository.getParticipant(participantId);
      expect(record).toMatchObject({ reminderOptIn: false, marketingConsentAt: null, unsubscribedAt: world.now, consentAt: expect.any(Date), normalizedEmail: "kate@example.test" });

      world.now = at(3, 15);
      const again = await app.unsubscribe(request("/api/advent/unsubscribe", { method: "POST", form: { t: token } }));
      expect(location(again).search).toBe("?done=1");
      expect((await app.repository.getParticipant(participantId))?.unsubscribedAt).toEqual(at(3, 9));
    });

    it("форма без Origin или с чужим Origin — 403 и ничего не меняется; неверный токен — ?error=1", async () => {
      const { app, token, participantId } = await withMail();
      expect((await app.unsubscribe(request("/api/advent/unsubscribe", { method: "POST", origin: null, form: { t: token } }))).status).toBe(403);
      expect((await app.unsubscribe(request("/api/advent/unsubscribe", { method: "POST", origin: "https://evil.example", form: { t: token } }))).status).toBe(403);
      expect((await app.repository.getParticipant(participantId))?.reminderOptIn).toBe(true);
      const bad = await app.unsubscribe(request("/api/advent/unsubscribe", { method: "POST", form: { t: "н".repeat(30) } }));
      expect(location(bad).search).toBe("?error=1");
      const missing = await app.unsubscribe(request("/api/advent/unsubscribe", { method: "POST", form: {} }));
      expect(location(missing).search).toBe("?error=1");
    });

    it("RFC 8058: POST на адрес из List-Unsubscribe без Origin отключает напоминания, повтор — тоже 200", async () => {
      const { app, mail, participantId } = await withMail();
      const url = new URL(mail.unsubscribeOneClickUrl);
      const oneClick = () =>
        app.oneClick(request(`${url.pathname}${url.search}`, { method: "POST", origin: null, form: { "List-Unsubscribe": "One-Click" } }));
      const response = await oneClick();
      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ unsubscribed: true });
      expect(await app.repository.getParticipant(participantId)).toMatchObject({ reminderOptIn: false, marketingConsentAt: null, consentAt: expect.any(Date) });
      expect((await oneClick()).status).toBe(200);
    });

    it("one-click: неверный и неизвестный токен не отключают никого", async () => {
      const { app, participantId } = await withMail();
      const short = await app.oneClick(request("/api/advent/unsubscribe/one-click?t=abc", { method: "POST", origin: null }));
      expect(short.status).toBe(400);
      const unknown = await app.oneClick(request(`/api/advent/unsubscribe/one-click?t=${"z".repeat(43)}`, { method: "POST", origin: null }));
      expect(unknown.status).toBe(404);
      expect((await app.repository.getParticipant(participantId))?.reminderOptIn).toBe(true);
    });

    it("GET (в том числе от почтового сканера) ничего не меняет: ведёт на страницу с кнопкой", async () => {
      const { app, token, participantId } = await withMail();
      const response = await app.oneClickGet(request(`/api/advent/unsubscribe/one-click?t=${token}`));
      expect(response.status).toBe(303);
      expect(location(response).pathname).toBe("/unsubscribe");
      expect(location(response).searchParams.get("t")).toBe(token);
      expect((await app.repository.getParticipant(participantId))?.reminderOptIn).toBe(true);
      const invalid = await app.oneClickGet(request("/api/advent/unsubscribe/one-click?t=1"));
      expect(location(invalid).search).toBe("?error=1");
    });

    it("после отписки следующий запуск рассылки этому участнику не шлёт", async () => {
      const { app, token } = await withMail();
      await app.unsubscribe(request("/api/advent/unsubscribe", { method: "POST", form: { t: token } }));
      const before = world.sent.length;
      await remind(app, at(4, 9));
      expect(world.sent).toHaveLength(before);
    });
  });

  describe("журнал и метрики", () => {
    it("в журнал не попадают email, токены входа и отписки, ссылки с токенами", async () => {
      const app = await boot();
      const { cookie } = await subscriber(app, "secret.person@example.test");
      const { mail } = await remind(app);
      const button = new URL(mail!.link);
      const token = new URL(mail!.unsubscribeUrl).searchParams.get("t")!;
      await app.open(request(`${button.pathname}${button.search}`, { cookie }));
      await app.open(request(`${button.pathname}${button.search}`));
      await app.reminderLogin(request("/api/advent/reminders/login", { method: "POST", form: { r: button.searchParams.get("r")! } }));
      const loginToken = world.login.at(-1)!;
      await app.unsubscribe(request("/api/advent/unsubscribe", { method: "POST", form: { t: token } }));
      await app.oneClick(request(`/api/advent/unsubscribe/one-click?t=${token}`, { method: "POST", origin: null }));
      await app.reminders(request("/api/advent/reminders", { method: "POST", cookie, body: { enabled: true, marketingConsent: true } }));
      const text = logs.join("\n");
      expect(text).toContain("advent_reminder_login_requested");
      for (const secret of ["secret.person@example.test", token, loginToken, "unsubscribe?t=", "reminders/open?r=", "verify?token="]) expect(text).not.toContain(secret);
    });
  });
});
