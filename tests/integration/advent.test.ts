import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { packSchema } from "@/config/pack";
import { adventSchema } from "@/config/advent-schema";
import { correctPayload } from "@/domain/solve";
import { overrideServices } from "@/server/container";
import { hashToken } from "@/server/crypto";
import { getPrisma } from "@/server/db";
import { overrideTenants, loadTenants } from "@/server/tenants";
import { ADVENT_COOKIE } from "@/server/advent-api";

import { POST as createParticipant } from "@/app/api/advent/participants/route";
import { GET as getState } from "@/app/api/advent/state/route";
import { POST as postOpen } from "@/app/api/advent/days/[n]/open/route";
import { POST as postBlock } from "@/app/api/advent/days/[n]/blocks/[i]/route";
import { POST as postIdentityRequest } from "@/app/api/advent/identity/request/route";
import { GET as getIdentityVerify, POST as postIdentityVerify } from "@/app/api/advent/identity/verify/route";
import { POST as createSession } from "@/app/api/sessions/route";

import { adventFixture, adventPackFixture } from "../fixtures/advent";
import { at } from "../support/advent";
import { smallCampaign } from "../support/small-campaign";
import { sensitiveValues } from "./helpers/leak-guard";

const HOST = "advent.test";
const QUIZ_HOST = "quiz-side.test";
const advent = adventSchema.parse(adventFixture());

const clock = { value: at(1, 12) };
const sent: Array<{ email: string; link: string; token: string }> = [];

function request(path: string, init: { method?: string; host?: string; cookie?: string | null; body?: unknown; headers?: Record<string, string> } = {}): NextRequest {
  const host = init.host ?? HOST;
  const method = init.method ?? "GET";
  const headers = new Headers({ host, ...init.headers });
  if (method !== "GET") headers.set("origin", `http://${host}`);
  if (init.cookie) headers.set("cookie", `${ADVENT_COOKIE}=${init.cookie}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(new URL(path, `http://${host}`), { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const json = (response: Response) => response.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function start(): Promise<{ cookie: string; participantId: string }> {
  const response = await createParticipant(request("/api/advent/participants", { method: "POST" }));
  expect(response.status).toBe(200);
  return { cookie: response.cookies.get(ADVENT_COOKIE)!.value, participantId: (await json(response)).participantId };
}

const open = (cookie: string, n: number) => postOpen(request(`/api/advent/days/${n}/open`, { method: "POST", cookie }), ctx({ n: String(n) }));
const block = (cookie: string, n: number, i: number, payload?: unknown) =>
  postBlock(request(`/api/advent/days/${n}/blocks/${i}`, { method: "POST", cookie, body: payload === undefined ? undefined : { payload } }), ctx({ n: String(n), i: String(i) }));
const requestLink = (cookie: string, email: string, extra: Record<string, unknown> = {}) =>
  postIdentityRequest(request("/api/advent/identity/request", { method: "POST", cookie, body: { email, consent: true, ...extra } }));
/** Кнопка «Войти» промежуточной страницы (POST тратит ссылку). */
const verify = (token: string, cookie: string | null = null) => postIdentityVerify(request("/api/advent/identity/verify", { method: "POST", cookie, body: { token } }));

describe("адвент: маршруты на PostgreSQL", () => {
  beforeEach(() => {
    clock.value = at(1, 12);
    sent.length = 0;
    overrideServices({
      now: () => new Date(clock.value),
      sendLogin: async (email, link) => {
        const token = new URL(link).searchParams.get("token")!;
        sensitiveValues.add(token);
        sensitiveValues.add(email);
        sent.push({ email, link, token });
      }
    });
    overrideTenants(
      loadTenants([
        { ...adventPackFixture(), hosts: [HOST] },
        packSchema.parse({ tenant: "quiz-side", hosts: [QUIZ_HOST], campaign: smallCampaign("quiz-side-campaign") })
      ])
    );
  });
  afterEach(() => overrideTenants(null));

  it("участник: в БД только хеш ключа, кампания создана, подаренный день выдан без кода", async () => {
    const { cookie, participantId } = await start();
    sensitiveValues.add(cookie);
    const prisma = getPrisma();
    const row = await prisma.participant.findUniqueOrThrow({ where: { id: participantId } });
    expect(row.accessKeyHash).toBe(hashToken(cookie));
    expect(row.campaignSlug).toBe(advent.slug);
    expect(await prisma.campaign.findUnique({ where: { slug: advent.slug } })).not.toBeNull();
    expect(await prisma.rewardGrant.findMany({ where: { participantId } })).toMatchObject([{ source: "endowed", day: 0, code: null }]);
    const again = await createParticipant(request("/api/advent/participants", { method: "POST", cookie }));
    expect((await json(again)).participantId).toBe(participantId);
    expect(await prisma.participant.count()).toBe(1);
  });

  it("полный день: открыть, пройти блоки, награда дня; состояние не содержит ответов до фиксации", async () => {
    const { cookie, participantId } = await start();
    const opened = await json(await open(cookie, 1));
    expect(JSON.stringify(opened)).not.toMatch(/correctOptionId|correctOptionIds|correctEnabledIds|correctOrder|fakeLetterId|"explanation"|"tip"|correctIds/);
    const day = advent.days[0];
    for (const [index, item] of day.blocks.entries()) {
      if (item.type === "story") expect((await block(cookie, 1, index)).status).toBe(200);
      if (item.type === "task") {
        const answered = await json(await block(cookie, 1, index, correctPayload(item.task)));
        expect(answered.block.outcome).toMatchObject({ base: 100 });
      }
    }
    const prisma = getPrisma();
    expect(await prisma.dayOpen.findMany({ where: { participantId } })).toMatchObject([{ day: 1, onTime: true }]);
    expect(await prisma.dayBlockResult.count({ where: { participantId } })).toBe(2);
    const grants = await prisma.rewardGrant.findMany({ where: { participantId }, orderBy: { source: "asc" } });
    expect(grants.map((grant) => `${grant.source}:${grant.day}:${grant.rewardId}:${grant.code}`).sort()).toEqual(["day:1:daily-gift:null", "endowed:0:endowed:null"]);
    // Блок подарка дня 1 пока не готов (A2).
    const promoIndex = day.blocks.findIndex((item) => item.type === "promo");
    expect((await block(cookie, 1, promoIndex, {})).status).toBe(409);
  });

  it("параллельные запросы не дублируют ни дни, ни ответы, ни награды", async () => {
    const { cookie, participantId } = await start();
    const day = advent.days[0];
    const taskIndex = day.blocks.findIndex((item) => item.type === "task");
    const task = day.blocks[taskIndex];
    if (task.type !== "task") throw new Error("задание");

    const opens = await Promise.all(Array.from({ length: 8 }, () => open(cookie, 1)));
    expect(opens.map((response) => response.status)).toEqual(Array(8).fill(200));
    const answers = await Promise.all(Array.from({ length: 8 }, (_, index) => block(cookie, 1, taskIndex, index % 2 === 0 ? correctPayload(task.task) : { optionId: "нет" })));
    // Первый записанный ответ побеждает; остальные видят его же (неверная форма могла получить 400 до записи).
    const ok = answers.filter((response) => response.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const outcomes = await Promise.all(ok.map(async (response) => (await json(response)).block.outcome.base));
    expect(new Set(outcomes).size).toBe(1);
    await Promise.all(Array.from({ length: 4 }, () => block(cookie, 1, 0)));

    const prisma = getPrisma();
    expect(await prisma.dayOpen.count({ where: { participantId } })).toBe(1);
    expect(await prisma.dayBlockResult.count({ where: { participantId, blockIndex: taskIndex } })).toBe(1);
    const dayGrants = await prisma.rewardGrant.count({ where: { participantId, source: "day", day: 1 } });
    expect(dayGrants).toBe(1);
  });

  it("бонус за возвращение один раз за кампанию, в том числе при параллельных открытиях", async () => {
    const { cookie, participantId } = await start();
    await open(cookie, 1);
    clock.value = at(3, 12);
    await open(cookie, 3); // день 2 закрыла заморозка
    clock.value = at(5, 12); // день 4 пропущен: серия оборвана
    const results = await Promise.all(Array.from({ length: 6 }, () => open(cookie, 5)));
    expect(results.map((response) => response.status)).toEqual(Array(6).fill(200));
    clock.value = at(8, 12);
    await open(cookie, 8); // новый обрыв: бонус уже был
    const comebacks = await getPrisma().rewardGrant.findMany({ where: { participantId, source: "comeback" } });
    expect(comebacks).toMatchObject([{ day: 0, rewardId: "comeback-gift", code: null }]);
  });

  it("asOf: вне production работает; недопустимые дни дают 409", async () => {
    const { cookie } = await start();
    const state = await json(await getState(request("/api/advent/state?asOf=2026-12-26T12:00:00%2B03:00", { cookie })));
    expect(state.today).toBe(7);
    const early = await postOpen(request("/api/advent/days/9/open", { method: "POST", cookie }), ctx({ n: "9" }));
    expect(early.status).toBe(409);
  });

  it("ссылка входа: токен и email в БД так, как задумано; подтверждение привязывает устройство; ссылка одноразовая", async () => {
    const { cookie, participantId } = await start();
    await open(cookie, 1);
    const response = await requestLink(cookie, "  Kate@Example.TEST ", { marketingConsent: true, reminderOptIn: true });
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].email).toBe("kate@example.test");
    expect(sent[0].link.startsWith(`http://${HOST}/api/advent/identity/verify?token=`)).toBe(true);

    const prisma = getPrisma();
    const stored = await prisma.loginToken.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).toBe(hashToken(sent[0].token));
    expect(stored[0].tokenHash).not.toBe(sent[0].token);
    expect(stored[0].normalizedEmail).toBe("kate@example.test");
    expect(stored[0].usedAt).toBeNull();
    // До подтверждения email за участником не закреплён.
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: participantId } })).normalizedEmail).toBeNull();

    // Переход из письма (в том числе почтовым сканером) ссылку не тратит.
    const opened = await getIdentityVerify(request(`/api/advent/identity/verify?token=${sent[0].token}`));
    expect(opened.headers.get("location")).toBe(`http://${HOST}/login?token=${sent[0].token}`);
    expect((await prisma.loginToken.findUniqueOrThrow({ where: { tokenHash: stored[0].tokenHash } })).usedAt).toBeNull();

    const verified = await verify(sent[0].token, cookie);
    expect(verified.status).toBe(303);
    expect(verified.headers.get("location")).toBe(`http://${HOST}/`);
    const fresh = verified.cookies.get(ADVENT_COOKIE)!.value;
    sensitiveValues.add(fresh);
    const row = await prisma.participant.findUniqueOrThrow({ where: { id: participantId } });
    expect(row).toMatchObject({ normalizedEmail: "kate@example.test", reminderOptIn: true });
    expect(row.consentAt).not.toBeNull();
    expect(row.marketingConsentAt).not.toBeNull();
    expect((await prisma.loginToken.findUniqueOrThrow({ where: { tokenHash: stored[0].tokenHash } })).usedAt).not.toBeNull();
    expect((await json(await getState(request("/api/advent/state", { cookie: fresh })))).participant.id).toBe(participantId);

    const reused = await verify(sent[0].token, fresh);
    expect(reused.headers.get("location")).toBe(`http://${HOST}/?login=error`);
  });

  it("истёкшая ссылка (30 минут) не срабатывает", async () => {
    const { cookie, participantId } = await start();
    await requestLink(cookie, "late@example.test");
    clock.value = new Date(clock.value.getTime() + 31 * 60 * 1000);
    const late = await verify(sent[0].token);
    expect(late.headers.get("location")).toBe(`http://${HOST}/?login=error`);
    expect((await getPrisma().participant.findUniqueOrThrow({ where: { id: participantId } })).normalizedEmail).toBeNull();
  });

  it("второе устройство: прогресс объединён, награды без дублей, участник один", async () => {
    const a = await start();
    await open(a.cookie, 1);
    await requestLink(a.cookie, "kate@example.test");
    await verify(sent[0].token, a.cookie);

    clock.value = at(2, 12);
    const b = await start();
    await open(b.cookie, 2);
    await open(b.cookie, 1);
    await requestLink(b.cookie, "KATE@example.test", { marketingConsent: true });
    const verified = await verify(sent[1].token, b.cookie);
    const merged = verified.cookies.get(ADVENT_COOKIE)!.value;

    const prisma = getPrisma();
    expect(await prisma.participant.findMany({ where: { normalizedEmail: "kate@example.test" } })).toHaveLength(1);
    expect(await prisma.participant.count()).toBe(1);
    const state = await json(await getState(request("/api/advent/state", { cookie: merged })));
    expect(state.participant.id).toBe(a.participantId);
    expect(state.doors.slice(0, 2).map((door: { status: string }) => door.status)).toEqual(["opened", "opened"]);
    const grants = await prisma.rewardGrant.findMany({ where: { participantId: a.participantId } });
    expect(new Set(grants.map((grant) => `${grant.source}:${grant.day}`)).size).toBe(grants.length);
    // Cookie обоих браузеров ведут к одному участнику.
    expect((await json(await getState(request("/api/advent/state", { cookie: b.cookie })))).participant.id).toBe(a.participantId);
    expect((await json(await getState(request("/api/advent/state", { cookie: a.cookie })))).participant.id).toBe(a.participantId);
    expect(state.participant.marketingConsent).toBe(true);
  });

  it("два устройства подтверждают один email одновременно: остаётся один участник с этим email", async () => {
    const a = await start();
    const b = await start();
    await open(a.cookie, 1);
    await requestLink(a.cookie, "race@example.test");
    await requestLink(b.cookie, "race@example.test");
    const [first, second] = await Promise.all([verify(sent[0].token, a.cookie), verify(sent[1].token, b.cookie)]);
    expect(first.headers.get("location")).toBe(`http://${HOST}/`);
    expect(second.headers.get("location")).toBe(`http://${HOST}/`);
    const prisma = getPrisma();
    expect(await prisma.participant.findMany({ where: { normalizedEmail: "race@example.test" } })).toHaveLength(1);
    expect(await prisma.participant.count()).toBe(1);
    expect(await prisma.dayOpen.count()).toBe(1);
  });

  it("запрос ссылки: лимит и валидация, письмо не уходит без согласия", async () => {
    const { cookie } = await start();
    const noConsent = await postIdentityRequest(request("/api/advent/identity/request", { method: "POST", cookie, body: { email: "a@b.co", consent: false } }));
    expect(noConsent.status).toBe(409);
    expect(sent).toEqual([]);
    // Отказ без согласия тоже считается запросом: из лимита в 5 осталось 4.
    for (let index = 0; index < 4; index += 1) expect((await requestLink(cookie, `u${index}@example.test`)).status).toBe(200);
    expect((await requestLink(cookie, "u9@example.test")).status).toBe(429);
  });

  it("чужое семейство: квиз на адвент-хосте и адвент на квиз-хосте — 404", async () => {
    const quizOnAdvent = await createSession(request("/api/sessions", { method: "POST" }));
    expect(quizOnAdvent.status).toBe(404);
    const adventOnQuiz = await createParticipant(request("/api/advent/participants", { method: "POST", host: QUIZ_HOST }));
    expect(adventOnQuiz.status).toBe(404);
    expect(await getPrisma().participant.count()).toBe(0);
  });
});
