import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { packSchema } from "@/config/pack";
import { correctPayload } from "@/domain/solve";
import { adventConfig, at } from "../support/advent";
import { adventPackFixture } from "../fixtures/advent";
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

// Репозиторий и часы живут между перезагрузками модулей. Сервисы собираются в `boot` после `vi.resetModules()`,
// чтобы классы ошибок у сервисов и у маршрутов были из одного графа модулей (иначе `instanceof DomainError` не сработает).
const world = vi.hoisted(() => ({
  repository: null as unknown,
  now: new Date(),
  sent: [] as Array<{ email: string; link: string; token: string }>,
  audit: [] as string[],
  build: null as null | ((tenant: unknown) => unknown)
}));

vi.mock("@/server/container", () => ({
  getNow: () => new Date(world.now),
  getServices: () => {
    throw new Error("квиз-сервисы в этом тесте не нужны");
  },
  getAdventServices: (tenant: unknown) => world.build!(tenant)
}));

const ADVENT_HOST = "advent.test";
const QUIZ_HOST = "quiz.test";

type Options = { nodeEnv?: string; demo?: boolean };

async function boot(options: Options = {}) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("NODE_ENV", options.nodeEnv ?? "test");
  const { InMemoryAdventRepository } = await import("@/server/repositories/in-memory-advent-repository");
  const { AdventService } = await import("@/server/services/advent-service");
  const { IdentityService } = await import("@/server/services/identity-service");
  const repository = new InMemoryAdventRepository();
  world.repository = repository;
  world.build = (tenant) => {
    const { advent } = tenant as { advent: import("@/config/advent-schema").AdventConfig };
    return {
      prisma: { campaign: { upsert: async () => undefined } },
      repository,
      adventService: new AdventService(repository, advent),
      identityService: new IdentityService({
        repository,
        advent,
        verifyEndpoint: "https://advent.test/api/advent/identity/verify",
        sendLoginLink: async (email, link) => {
          world.sent.push({ email, link, token: new URL(link).searchParams.get("token")! });
        },
        recordDeliveryFailure: async (id) => {
          world.audit.push(id);
        }
      })
    };
  };
  world.sent.length = 0;
  world.audit.length = 0;
  world.now = at(3, 12);

  const tenants = await import("@/server/tenants");
  const adventPack = { ...adventPackFixture(), hosts: [ADVENT_HOST], demo: options.demo ?? false };
  const quizPack = packSchema.parse({ tenant: "quiz", hosts: [QUIZ_HOST], campaign: smallCampaign("quiz-campaign") });
  tenants.overrideTenants(tenants.loadTenants([adventPack, quizPack]));

  const api = await import("@/server/advent-api");
  return {
    ADVENT_COOKIE: api.ADVENT_COOKIE,
    participants: (await import("@/app/api/advent/participants/route")).POST,
    state: (await import("@/app/api/advent/state/route")).GET,
    open: (await import("@/app/api/advent/days/[n]/open/route")).POST,
    block: (await import("@/app/api/advent/days/[n]/blocks/[i]/route")).POST,
    identityRequest: (await import("@/app/api/advent/identity/request/route")).POST,
    identityVerify: (await import("@/app/api/advent/identity/verify/route")).GET,
    identityConfirm: (await import("@/app/api/advent/identity/verify/route")).POST,
    sessions: (await import("@/app/api/sessions/route")).POST,
    claimsVerify: (await import("@/app/api/claims/verify/route")).GET,
    tenants
  };
}

type Init = { method?: string; host?: string; cookie?: string | null; origin?: string | null; body?: unknown; headers?: Record<string, string> };

function request(path: string, init: Init = {}): NextRequest {
  const host = init.host ?? ADVENT_HOST;
  const method = init.method ?? "GET";
  const headers = new Headers({ host, ...init.headers });
  const origin = init.origin === undefined ? (method === "GET" ? null : `https://${host}`) : init.origin;
  if (origin) headers.set("origin", origin);
  if (init.cookie) headers.set("cookie", `advent_participant_access=${init.cookie}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(new URL(path, `https://${host}`), { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

/** Кнопка «Войти» промежуточной страницы: POST с токеном. */
function confirmLogin(app: Awaited<ReturnType<typeof boot>>, token: string, cookie: string | null = null, init: Init = {}) {
  return app.identityConfirm(request("/api/advent/identity/verify", { method: "POST", cookie, body: { token }, ...init }));
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const json = (response: Response) => response.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET_FIELDS = /correctOptionId|correctOptionIds|correctEnabledIds|correctOrder|fakeLetterId|"thanks"|"oops"|"explanation"|"tip"|correctIds/;
const advent = adventConfig();

async function start(app: Awaited<ReturnType<typeof boot>>, init: Init = {}) {
  const response = await app.participants(request("/api/advent/participants", { method: "POST", ...init }));
  const cookie = response.cookies.get(app.ADVENT_COOKIE)?.value;
  return { response, cookie: cookie!, body: await json(response) };
}

describe("маршруты адвента", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("POST /api/advent/participants", () => {
    it("создаёт участника: cookie httpOnly, SameSite=Lax, срок — claimEndsAt; в состоянии подаренный день", async () => {
      const app = await boot();
      const { response, cookie, body } = await start(app);
      const set = response.cookies.get(app.ADVENT_COOKIE);
      expect(response.status).toBe(200);
      expect(set).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
      expect(set?.secure).toBeFalsy();
      expect(new Date(set!.expires!).toISOString()).toBe(new Date(advent.schedule.claimEndsAt).toISOString());
      expect(cookie.length).toBeGreaterThanOrEqual(32);
      expect(body.participantId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.state).toMatchObject({ phase: "running", today: 3, streak: { endowed: true, progress: 1 } });
      expect(JSON.stringify(body)).not.toContain(cookie);
    });

    it("в production cookie с Secure", async () => {
      const app = await boot({ nodeEnv: "production" });
      const { response } = await start(app);
      expect(response.cookies.get(app.ADVENT_COOKIE)?.secure).toBe(true);
    });

    it("повторный вызов с валидной cookie возвращает того же участника без новой cookie", async () => {
      const app = await boot();
      const first = await start(app);
      const again = await app.participants(request("/api/advent/participants", { method: "POST", cookie: first.cookie }));
      expect(again.cookies.get(app.ADVENT_COOKIE)).toBeUndefined();
      expect((await json(again)).participantId).toBe(first.body.participantId);
    });

    it("чужой или отсутствующий Origin — 403; лимит 60 в минуту — 429", async () => {
      const app = await boot();
      expect((await app.participants(request("/api/advent/participants", { method: "POST", origin: "https://evil.example" }))).status).toBe(403);
      expect((await app.participants(request("/api/advent/participants", { method: "POST", origin: null }))).status).toBe(403);
      for (let index = 0; index < 60; index += 1) {
        expect((await app.participants(request("/api/advent/participants", { method: "POST" }))).status).toBe(200);
      }
      expect((await app.participants(request("/api/advent/participants", { method: "POST" }))).status).toBe(429);
    });
  });

  describe("GET /api/advent/state", () => {
    it("без cookie и с чужой cookie — 401; с cookie — состояние без ответов и без исходов удачи", async () => {
      const app = await boot();
      expect((await app.state(request("/api/advent/state"))).status).toBe(401);
      expect((await app.state(request("/api/advent/state", { cookie: "foreign-key" }))).status).toBe(401);
      const { cookie } = await start(app);
      const opened = await app.open(request("/api/advent/days/3/open", { method: "POST", cookie }), ctx({ n: "3" }));
      expect(opened.status).toBe(200);
      const response = await app.state(request("/api/advent/state", { cookie }));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const text = JSON.stringify(await json(response));
      expect(text).not.toMatch(SECRET_FIELDS);
      expect(text).not.toMatch(/luck-a|luck-b/);
    });
  });

  describe("открытие дня и блоки", () => {
    it("открывает сегодняшний день, повтор идемпотентен, будущий — 409, мусорный номер — 404", async () => {
      const app = await boot();
      const { cookie } = await start(app);
      const open = (n: string) => app.open(request(`/api/advent/days/${n}/open`, { method: "POST", cookie }), ctx({ n }));
      const first = await json(await open("3"));
      const second = await json(await open("3"));
      expect(first.state.doors[2].status).toBe("opened");
      expect(second.state.days).toEqual(first.state.days);
      expect((await open("4")).status).toBe(409);
      expect((await open("13")).status).toBe(404);
      expect((await open("abc")).status).toBe(404);
      expect((await open("-1")).status).toBe(404);
    });

    it("без cookie и без Origin действия закрыты", async () => {
      const app = await boot();
      expect((await app.open(request("/api/advent/days/3/open", { method: "POST" }), ctx({ n: "3" }))).status).toBe(401);
      const { cookie } = await start(app);
      expect((await app.open(request("/api/advent/days/3/open", { method: "POST", cookie, origin: "https://evil.example" }), ctx({ n: "3" }))).status).toBe(403);
    });

    it("история подтверждается пустым телом, задание — ответом: разбор приходит после фиксации; повтор возвращает то же", async () => {
      const app = await boot();
      const { cookie } = await start(app);
      await app.open(request("/api/advent/days/3/open", { method: "POST", cookie }), ctx({ n: "3" }));
      const day = advent.days[2];
      const storyIndex = day.blocks.findIndex((block) => block.type === "story");
      const taskIndex = day.blocks.findIndex((block) => block.type === "task");
      const task = day.blocks[taskIndex];
      if (task.type !== "task") throw new Error("задание");
      const post = (index: number, body?: unknown) =>
        app.block(request(`/api/advent/days/3/blocks/${index}`, { method: "POST", cookie, body }), ctx({ n: "3", i: String(index) }));

      const story = await post(storyIndex);
      expect(story.status).toBe(200);
      expect((await json(story)).block).toMatchObject({ type: "story", outcome: null });

      const wrong = await post(taskIndex, { payload: { optionId: "нет-такого" } });
      expect(wrong.status).toBe(400);

      const answered = await json(await post(taskIndex, { payload: correctPayload(task.task) }));
      expect(answered.block.outcome).toMatchObject({ base: 100, outcome: "perfect" });
      expect(answered.block.outcome.correctIds.length).toBeGreaterThan(0);
      const again = await json(await post(taskIndex, { payload: { optionId: "другое" } }));
      expect(again.block.outcome).toEqual(answered.block.outcome);
      expect(answered.state.doors[2]).toMatchObject({ completed: true });
      expect(answered.state.grants.some((grant: { source: string; day: number }) => grant.source === "day" && grant.day === 3)).toBe(true);
    });

    it("блок удачи — 409 reward_blocks_not_ready; битый JSON — 400; несуществующий блок — 404", async () => {
      const app = await boot();
      world.now = at(4, 12);
      const { cookie } = await start(app);
      await app.open(request("/api/advent/days/4/open", { method: "POST", cookie }), ctx({ n: "4" }));
      const luckIndex = advent.days[3].blocks.findIndex((block) => block.type === "luck");
      const luck = await app.block(request(`/api/advent/days/4/blocks/${luckIndex}`, { method: "POST", cookie, body: { payload: {} } }), ctx({ n: "4", i: String(luckIndex) }));
      expect(luck.status).toBe(409);
      expect((await json(luck)).error).toContain("reward_blocks_not_ready");

      const broken = new NextRequest(new URL("/api/advent/days/4/blocks/0", `https://${ADVENT_HOST}`), {
        method: "POST",
        headers: { host: ADVENT_HOST, origin: `https://${ADVENT_HOST}`, cookie: `advent_participant_access=${cookie}` },
        body: "{не json"
      });
      expect((await app.block(broken, ctx({ n: "4", i: "0" }))).status).toBe(400);
      expect((await app.block(request("/api/advent/days/4/blocks/9", { method: "POST", cookie }), ctx({ n: "4", i: "9" }))).status).toBe(404);
    });
  });

  describe("asOf", () => {
    const stateAt = (app: Awaited<ReturnType<typeof boot>>, cookie: string, extra: { query?: string; headers?: Record<string, string> } = {}) =>
      app.state(request(`/api/advent/state${extra.query ?? ""}`, { cookie, headers: extra.headers }));

    it("вне production сдвигает время: query и заголовок; открывает «будущий» день и даёт полный путь", async () => {
      const app = await boot();
      const { cookie } = await start(app);
      expect((await json(await stateAt(app, cookie))).today).toBe(3);
      expect((await json(await stateAt(app, cookie, { query: `?asOf=${encodeURIComponent("2026-12-26T12:00:00+03:00")}` }))).today).toBe(7);
      expect((await json(await stateAt(app, cookie, { headers: { "x-advent-as-of": "2026-12-31T12:00:00+03:00" } }))).today).toBe(12);

      const open = await app.open(
        request("/api/advent/days/7/open?asOf=2026-12-26T12:00:00%2B03:00", { method: "POST", cookie }),
        ctx({ n: "7" })
      );
      expect(open.status).toBe(200);
      expect((await json(open)).state.doors[6].status).toBe("opened");
    });

    it("неверный asOf — 400", async () => {
      const app = await boot();
      const { cookie } = await start(app);
      for (const value of ["вчера", "2026-12-26", "2026-13-40T00:00:00Z"]) {
        expect((await stateAt(app, cookie, { query: `?asOf=${encodeURIComponent(value)}` })).status).toBe(400);
      }
    });

    it("в production игнорируется, а попытка пишется в журнал без персональных данных", async () => {
      const app = await boot({ nodeEnv: "production" });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { cookie } = await start(app);
      const stateBody = await json(await stateAt(app, cookie, { query: "?asOf=2026-12-31T12:00:00%2B03:00", headers: { "x-advent-as-of": "2026-12-31T12:00:00+03:00" } }));
      expect(stateBody.today).toBe(3);
      expect(stateBody.serverTime).toBe(world.now.toISOString());
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(JSON.parse(line)).toEqual({ event: "advent_as_of_ignored", tenant: "zerno-advent", source: "query" });
      // Мусорное значение в production тоже просто игнорируется, а не даёт 400.
      expect((await stateAt(app, cookie, { query: "?asOf=вчера" })).status).toBe(200);
    });

    it("в production работает для демо-пакета (demo: true)", async () => {
      const app = await boot({ nodeEnv: "production", demo: true });
      const { cookie } = await start(app);
      expect((await json(await stateAt(app, cookie, { query: "?asOf=2026-12-26T12:00:00%2B03:00" }))).today).toBe(7);
    });
  });

  describe("чужое семейство арендатора", () => {
    it("маршруты адвента на квиз-хосте — 404", async () => {
      const app = await boot();
      const host = QUIZ_HOST;
      expect((await app.participants(request("/api/advent/participants", { method: "POST", host }))).status).toBe(404);
      expect((await app.state(request("/api/advent/state", { host }))).status).toBe(404);
      expect((await app.open(request("/api/advent/days/1/open", { method: "POST", host }), ctx({ n: "1" }))).status).toBe(404);
      expect((await app.block(request("/api/advent/days/1/blocks/0", { method: "POST", host }), ctx({ n: "1", i: "0" }))).status).toBe(404);
      expect((await app.identityRequest(request("/api/advent/identity/request", { method: "POST", host, body: { email: "a@b.co", consent: true } }))).status).toBe(404);
      expect((await app.identityVerify(request(`/api/advent/identity/verify?token=${"a".repeat(30)}`, { host }))).status).toBe(404);
      expect((await confirmLogin(app, "a".repeat(30), null, { host })).status).toBe(404);
    });

    it("квизовые маршруты на адвент-хосте — 404", async () => {
      const app = await boot();
      expect((await app.sessions(request("/api/sessions", { method: "POST" }))).status).toBe(404);
      expect((await app.claimsVerify(request(`/api/claims/verify?token=${"a".repeat(30)}`))).status).toBe(404);
    });
  });

  describe("вход по ссылке", () => {
    const requestLink = (app: Awaited<ReturnType<typeof boot>>, cookie: string, body: unknown, headers?: Record<string, string>) =>
      app.identityRequest(request("/api/advent/identity/request", { method: "POST", cookie, body, headers }));

    it("запрос: без согласия 409, неверный email 400, без cookie 401, успех — письмо со ссылкой", async () => {
      const app = await boot();
      expect((await requestLink(app, "", { email: "a@b.co", consent: true })).status).toBe(401);
      const { cookie } = await start(app);
      expect((await requestLink(app, cookie, { email: "a@b.co", consent: false })).status).toBe(409);
      expect((await requestLink(app, cookie, { email: "не-почта", consent: true })).status).toBe(400);
      expect((await requestLink(app, cookie, { email: "a@b.co" })).status).toBe(400);
      expect(world.sent).toEqual([]);
      const ok = await requestLink(app, cookie, { email: "Kate@Example.test", consent: true, marketingConsent: false, reminderOptIn: true });
      expect(ok.status).toBe(200);
      expect(await json(ok)).toEqual({ sent: true });
      expect(world.sent).toHaveLength(1);
      expect(world.sent[0].email).toBe("kate@example.test");
    });

    it("лимит: 5 запросов в минуту на IP и на участника", async () => {
      const app = await boot();
      const { cookie } = await start(app);
      for (let index = 0; index < 5; index += 1) {
        expect((await requestLink(app, cookie, { email: `u${index}@example.test`, consent: true }, { "x-forwarded-for": "10.0.0.1" })).status).toBe(200);
      }
      expect((await requestLink(app, cookie, { email: "u6@example.test", consent: true }, { "x-forwarded-for": "10.0.0.1" })).status).toBe(429);
      // Другой IP, тот же участник: сработал лимит участника.
      expect((await requestLink(app, cookie, { email: "u7@example.test", consent: true }, { "x-forwarded-for": "10.0.0.2" })).status).toBe(429);

      // Другой участник с того же IP: сработал лимит IP.
      const other = await start(app, { headers: { "x-forwarded-for": "10.0.0.1" } });
      expect((await requestLink(app, other.cookie, { email: "o@example.test", consent: true }, { "x-forwarded-for": "10.0.0.1" })).status).toBe(429);
      // Другой участник и другой IP проходят.
      expect((await requestLink(app, other.cookie, { email: "o@example.test", consent: true }, { "x-forwarded-for": "10.0.0.3" })).status).toBe(200);
    });

    it("лимит на адрес: 5 писем за 15 минут на один email с разных IP и участников, регистр не важен", async () => {
      const app = await boot();
      for (let index = 0; index < 5; index += 1) {
        const { cookie } = await start(app, { headers: { "x-forwarded-for": `10.1.0.${index}` } });
        const email = index % 2 === 0 ? "victim@example.test" : "VICTIM@example.test";
        expect((await requestLink(app, cookie, { email, consent: true }, { "x-forwarded-for": `10.1.0.${index}` })).status).toBe(200);
      }
      const { cookie } = await start(app, { headers: { "x-forwarded-for": "10.1.0.9" } });
      expect((await requestLink(app, cookie, { email: "victim@example.test", consent: true }, { "x-forwarded-for": "10.1.0.9" })).status).toBe(429);
      expect((await requestLink(app, cookie, { email: "other@example.test", consent: true }, { "x-forwarded-for": "10.1.0.9" })).status).toBe(200);
      expect(world.sent).toHaveLength(6);
    });

    it("GET из письма токен не тратит: ведёт на промежуточную страницу; битый токен — /?login=error", async () => {
      const app = await boot();
      const { cookie } = await start(app);
      await requestLink(app, cookie, { email: "kate@example.test", consent: true });
      const token = world.sent[0].token;
      // Почтовый сканер открывает ссылку без cookie, и не один раз.
      for (const withCookie of [null, null, cookie]) {
        const opened = await app.identityVerify(request(`/api/advent/identity/verify?token=${token}`, { cookie: withCookie }));
        expect(opened.status).toBe(303);
        expect(opened.headers.get("location")).toBe(`https://advent.test/login?token=${token}`);
        expect(opened.cookies.get(app.ADVENT_COOKIE)).toBeUndefined();
      }
      expect((await app.identityVerify(request("/api/advent/identity/verify?token=короткий"))).headers.get("location")).toBe("https://advent.test/?login=error");
      // Ссылка после сканера по-прежнему работает.
      expect((await confirmLogin(app, token, cookie)).headers.get("location")).toBe("https://advent.test/");
    });

    it("«Войти»: редирект на главную от адреса арендатора, новая cookie, ссылка одноразовая, ошибка — /?login=error", async () => {
      const app = await boot();
      const { cookie, body } = await start(app);
      await requestLink(app, cookie, { email: "kate@example.test", consent: true, marketingConsent: true });
      const verify = (token: string, withCookie: string | null = cookie) => confirmLogin(app, token, withCookie);

      const ok = await verify(world.sent[0].token);
      expect(ok.status).toBe(303);
      expect(ok.headers.get("location")).toBe("https://advent.test/");
      const fresh = ok.cookies.get(app.ADVENT_COOKIE);
      expect(fresh).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
      expect(fresh!.value).not.toBe(cookie);
      // Новая cookie ведёт к тому же участнику, с email и отдельным согласием на рассылку.
      const state = await json(await app.state(request("/api/advent/state", { cookie: fresh!.value })));
      expect(state.participant).toMatchObject({ id: body.participantId, email: "k***@example.test", consent: true, marketingConsent: true });

      const reused = await verify(world.sent[0].token);
      expect(reused.headers.get("location")).toBe("https://advent.test/?login=error");
      expect(reused.cookies.get(app.ADVENT_COOKIE)).toBeUndefined();
      expect((await verify("короткий")).headers.get("location")).toBe("https://advent.test/?login=error");
      expect((await verify("x".repeat(40))).headers.get("location")).toBe("https://advent.test/?login=error");
    });

    it("«Войти» принимает форму без JavaScript; без Origin или с чужим Origin — 403 и ссылка не тратится", async () => {
      const app = await boot();
      const { cookie } = await start(app);
      await requestLink(app, cookie, { email: "kate@example.test", consent: true });
      const token = world.sent[0].token;
      expect((await confirmLogin(app, token, cookie, { origin: null })).status).toBe(403);
      expect((await confirmLogin(app, token, cookie, { origin: "https://evil.test" })).status).toBe(403);

      const headers = new Headers({ host: ADVENT_HOST, origin: `https://${ADVENT_HOST}`, cookie: `advent_participant_access=${cookie}`, "content-type": "application/x-www-form-urlencoded" });
      const form = await app.identityConfirm(
        new NextRequest(new URL("/api/advent/identity/verify", `https://${ADVENT_HOST}`), { method: "POST", headers, body: new URLSearchParams({ token }).toString() })
      );
      expect(form.status).toBe(303);
      expect(form.headers.get("location")).toBe("https://advent.test/");
      expect(form.cookies.get(app.ADVENT_COOKIE)?.value).toBeTruthy();
    });

    it("ссылку на чужой адрес открыл владелец почты: cookie запросившего доступа не даёт", async () => {
      const app = await boot();
      const victim = await start(app);
      await requestLink(app, victim.cookie, { email: "victim@example.test", consent: true });
      const victimLogin = await confirmLogin(app, world.sent[0].token, victim.cookie);
      const victimCookie = victimLogin.cookies.get(app.ADVENT_COOKIE)!.value;

      const attacker = await start(app);
      await requestLink(app, attacker.cookie, { email: "victim@example.test", consent: true });
      // Жертва нажимает «Войти» на своём устройстве.
      await confirmLogin(app, world.sent[1].token, victimCookie);

      expect((await app.state(request("/api/advent/state", { cookie: attacker.cookie }))).status).toBe(401);
      expect((await json(await app.state(request("/api/advent/state", { cookie: victimCookie })))).participant.id).toBe(victim.body.participantId);
    });

    it("второе устройство: ссылка с другого браузера объединяет прогресс и открывает тот же аккаунт", async () => {
      const app = await boot();
      const a = await start(app);
      for (const n of ["1", "2"]) {
        world.now = at(Number(n), 10);
        await app.open(request(`/api/advent/days/${n}/open`, { method: "POST", cookie: a.cookie }), ctx({ n }));
      }
      world.now = at(3, 9);
      await requestLink(app, a.cookie, { email: "kate@example.test", consent: true });
      await confirmLogin(app, world.sent[0].token, a.cookie);

      // Второй браузер: свой анонимный участник открыл день 3, затем запрашивает ссылку на тот же email.
      const b = await start(app);
      await app.open(request("/api/advent/days/3/open", { method: "POST", cookie: b.cookie }), ctx({ n: "3" }));
      await requestLink(app, b.cookie, { email: "KATE@example.test", consent: true });
      const verified = await confirmLogin(app, world.sent[1].token, b.cookie);
      const cookie = verified.cookies.get(app.ADVENT_COOKIE)!.value;

      const merged = await json(await app.state(request("/api/advent/state", { cookie })));
      expect(merged.participant.id).toBe(a.body.participantId);
      expect(merged.doors.slice(0, 3).map((door: { status: string }) => door.status)).toEqual(["opened", "opened", "opened"]);
      // Старая cookie второго браузера тоже ведёт к объединённому участнику.
      expect((await json(await app.state(request("/api/advent/state", { cookie: b.cookie })))).participant.id).toBe(a.body.participantId);
    });

    it("в журналы не попадают email, токены, cookie", async () => {
      const spies = (["log", "info", "warn", "error"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
      const app = await boot();
      const { cookie } = await start(app);
      await requestLink(app, cookie, { email: "secret.person@example.test", consent: true });
      await app.identityVerify(request(`/api/advent/identity/verify?token=${world.sent[0].token}`, { cookie }));
      const verified = await confirmLogin(app, world.sent[0].token, cookie);
      await confirmLogin(app, world.sent[0].token, cookie);
      const output = spies.flatMap((spy) => spy.mock.calls).flat().map(String).join("\n");
      for (const secret of ["secret.person@example.test", world.sent[0].token, cookie, verified.cookies.get(app.ADVENT_COOKIE)!.value]) {
        expect(output).not.toContain(secret);
      }
    });
  });
});
