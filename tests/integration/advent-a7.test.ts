import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminAuthorized } from "@/server/admin";
import { ADVENT_COOKIE } from "@/server/advent-api";
import { clearLeaderboardCache, loadAdventAnalytics } from "@/server/advent-metrics";
import { ANALYTICS_TTL_MS } from "@/server/advent-report";
import { overrideServices } from "@/server/container";
import { getPrisma } from "@/server/db";
import { PrismaAdventRepository } from "@/server/repositories/prisma-advent-repository";
import { AdventService } from "@/server/services/advent-service";
import { RewardService } from "@/server/services/reward-service";
import { saveTenantAdmin } from "@/server/tenant-admins";
import { loadTenants, overrideTenants } from "@/server/tenants";
import { seedDemoAdvent, seededRandom } from "@/tools/advent-seed-demo";

import { POST as createParticipant } from "@/app/api/advent/participants/route";
import { POST as postOpen } from "@/app/api/advent/days/[n]/open/route";
import { POST as postTeam } from "@/app/api/advent/team/route";
import { GET as getLeaderboard } from "@/app/api/advent/leaderboard/route";
import { GET as getMetrics } from "@/app/api/admin/advent/metrics/route";
import { GET as getReportCsv } from "@/app/api/admin/advent/report/[name]/route";

import { adventPackFixture } from "../fixtures/advent";
import { adventConfig, at } from "../support/advent";
import { sensitiveValues } from "./helpers/leak-guard";

const HOST = "advent.test";
const SLUG = "zerno-advent";
const clock = { value: at(4, 12) };
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
const TEAMS = [
  { id: "t-north", title: "Север" },
  { id: "t-south", title: "Юг" }
];

function request(path: string, init: { method?: string; cookie?: string | null; auth?: string; body?: unknown } = {}): NextRequest {
  const method = init.method ?? "GET";
  const headers = new Headers({ host: HOST });
  if (method !== "GET") headers.set("origin", `http://${HOST}`);
  if (init.cookie) headers.set("cookie", `${ADVENT_COOKIE}=${init.cookie}`);
  if (init.auth) headers.set("authorization", init.auth);
  let body: string | undefined;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest(new URL(path, `http://${HOST}`), { method, headers, body });
}
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const json = (response: Response) => response.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function newPlayer(): Promise<string> {
  const created = await createParticipant(request("/api/advent/participants", { method: "POST" }));
  return created.cookies.get(ADVENT_COOKIE)!.value;
}

describe("метрики адвента, отчёт и рейтинг команд на PostgreSQL", () => {
  beforeEach(() => {
    clock.value = at(4, 12);
    clearLeaderboardCache();
    vi.stubEnv("SUPERADMIN", "");
    overrideServices({ now: () => new Date(clock.value) });
    const pack = adventPackFixture();
    pack.advent.audience = { kind: "employees", leaderboard: "teams", teams: TEAMS };
    pack.advent.days[1].title = "=HYPERLINK(\"http://evil.test\")";
    overrideTenants(loadTenants([{ ...pack, hosts: [HOST] }]));
  });
  afterEach(() => {
    overrideTenants(null);
    vi.unstubAllEnvs();
  });

  async function credentials() {
    const prisma = getPrisma();
    const operator = await saveTenantAdmin(prisma, { tenantSlug: SLUG, username: "ops" });
    const cashier = await saveTenantAdmin(prisma, { tenantSlug: SLUG, username: "kassa", role: "cashier" });
    const stranger = await saveTenantAdmin(prisma, { tenantSlug: "other-tenant", username: "ops" });
    for (const secret of [operator, cashier, stranger]) sensitiveValues.add(secret.password);
    return { operator: basic("ops", operator.password), cashier: basic("kassa", cashier.password), stranger: basic("ops", stranger.password) };
  }

  it("права: оператор видит метрики и CSV, кассир, аноним и оператор чужого арендатора — нет", async () => {
    const { operator, cashier, stranger } = await credentials();
    for (const name of ["days.csv", "rewards.csv", "cohorts.csv"]) {
      const path = `/api/admin/advent/report/${name}`;
      expect((await getReportCsv(request(path, { auth: operator }), ctx({ name }))).status, name).toBe(200);
      for (const auth of [cashier, stranger, undefined]) {
        expect((await getReportCsv(request(path, { auth }), ctx({ name }))).status, `${name} ${auth?.slice(0, 12)}`).toBe(401);
      }
    }
    expect((await getMetrics(request("/api/admin/advent/metrics", { auth: operator }))).status).toBe(200);
    expect((await getMetrics(request("/api/admin/advent/metrics", { auth: cashier }))).status).toBe(401);
    expect((await getReportCsv(request("/api/admin/advent/report/nope.csv", { auth: operator }), ctx({ name: "nope.csv" }))).status).toBe(404);
    // Страницы /admin и /admin/report закрыты той же проверкой, что и API: кассиру отказано.
    const headers = (auth: string) => new Headers({ host: HOST, authorization: auth });
    expect(await adminAuthorized(headers(operator))).toBe(true);
    expect(await adminAuthorized(headers(cashier))).toBe(false);
    expect(await adminAuthorized(headers(stranger))).toBe(false);
  });

  it("путь: игроки открывают двери, метрики и CSV считают их без email; формулы в названиях нейтрализованы", async () => {
    const { operator } = await credentials();
    const cookies = [await newPlayer(), await newPlayer(), await newPlayer()];
    for (const [index, cookie] of cookies.entries()) {
      // Сегодня 4-й день: все открывают его вовремя, первый ещё догоняет 3-й (окно догоняния — 1 день).
      expect((await postOpen(request("/api/advent/days/4/open", { method: "POST", cookie }), ctx({ n: "4" }))).status).toBe(200);
      if (index === 0) expect((await postOpen(request("/api/advent/days/3/open", { method: "POST", cookie }), ctx({ n: "3" }))).status).toBe(200);
    }
    const metrics = await json(await getMetrics(request("/api/admin/advent/metrics", { auth: operator })));
    const { analytics } = metrics;
    expect(analytics.kpis).toMatchObject({ participants: 3, players: 3, activeToday: 3 });
    const row = (day: number) => analytics.days.find((candidate: { day: number }) => candidate.day === day);
    expect(row(4)).toMatchObject({ onTime: 3, caughtUp: 0, active: 3, missed: 0 });
    expect(row(3)).toMatchObject({ onTime: 0, caughtUp: 1 });
    expect(analytics.doors.buckets).toEqual([{ value: 1, count: 2 }, { value: 2, count: 1 }]);
    expect(JSON.stringify(metrics)).not.toMatch(/@|accessKey|token/i);

    const csv = await (await getReportCsv(request("/api/admin/advent/report/days.csv", { auth: operator }), ctx({ name: "days.csv" }))).text();
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"")"`);
    expect(csv).not.toContain("@");
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("Открыли в свой день");
    // День 4: вовремя 3, догнали 0, всего 3, активных 3, пропустили 0.
    expect(lines.find((line) => line.startsWith('"4"'))).toContain('"3","0","3","3","0"');
    const cohorts = await (await getReportCsv(request("/api/admin/advent/report/cohorts.csv", { auth: operator }), ctx({ name: "cohorts.csv" }))).text();
    // Когорта из трёх человек меньше порога: числа скрыты.
    expect(cohorts.split("\r\n")[1]).toMatch(/^"2026-12-23","","","","","","",""$/);
  });

  it("команды: выбор и публичный рейтинг без имён и точных цифр; команды из 3 и 4 человек без цифр; кэш; чужая команда отвергается", async () => {
    const cookies = [] as string[];
    for (let index = 0; index < 4; index += 1) cookies.push(await newPlayer());
    const pick = (cookie: string, teamId: string | null) => postTeam(request("/api/advent/team", { method: "POST", cookie, body: { teamId } }));
    for (const cookie of cookies.slice(0, 3)) expect((await pick(cookie, "t-north")).status).toBe(200);
    expect((await pick(cookies[3], "t-south")).status).toBe(200);
    expect((await pick(cookies[3], "t-unknown")).status).toBe(400);
    expect((await postTeam(request("/api/advent/team", { method: "POST", body: { teamId: "t-north" } }))).status).toBe(401);
    for (const cookie of cookies) await postOpen(request("/api/advent/days/4/open", { method: "POST", cookie }), ctx({ n: "4" }));

    const board = await json(await getLeaderboard(request("/api/advent/leaderboard", { cookie: cookies[3] })));
    expect(board.mine).toBe("t-south");
    // Север — 3 участника, Юг — 1: обе меньше порога 5, цифр и мест нет.
    expect(board.teams).toEqual([
      { id: "t-north", title: "Север", rank: null, hidden: true, size: null, avgDoors: null, activeShare: null },
      { id: "t-south", title: "Юг", rank: null, hidden: true, size: null, avgDoors: null, activeShare: null }
    ]);
    expect(JSON.stringify(board)).not.toMatch(/participant|@|accessKey|members/i);

    // Кэш: ещё двое у «Севера» (стало 5) не меняют ответ в пределах TTL; после — Север с округлёнными цифрами и интервалом.
    for (const cookie of [await newPlayer(), await newPlayer()]) await pick(cookie, "t-north");
    const cached = await json(await getLeaderboard(request("/api/advent/leaderboard")));
    expect(cached.teams[0].hidden).toBe(true);
    clock.value = new Date(clock.value.getTime() + 4 * 60_000);
    const fresh = await json(await getLeaderboard(request("/api/advent/leaderboard")));
    // 3 двери на 5 человек = 0,6 → 0,5; играют 3 из 5 = 0,6.
    expect(fresh.teams[0]).toEqual({ id: "t-north", title: "Север", rank: 1, hidden: false, size: "5–9", avgDoors: 0.5, activeShare: 0.6 });
    expect(JSON.stringify(fresh)).not.toMatch(/members|"5"|:5[,}]/);
  });

  it("метрики панели кэшируются на минуту на арендатора: панель, CSV и API видят один снимок; потом пересчёт", async () => {
    const { operator } = await credentials();
    await postOpen(request("/api/advent/days/4/open", { method: "POST", cookie: await newPlayer() }), ctx({ n: "4" }));
    const first = (await json(await getMetrics(request("/api/admin/advent/metrics", { auth: operator })))).analytics;
    expect(first.kpis.players).toBe(1);
    await postOpen(request("/api/advent/days/4/open", { method: "POST", cookie: await newPlayer() }), ctx({ n: "4" }));
    clock.value = new Date(clock.value.getTime() + 30_000);
    const cached = (await json(await getMetrics(request("/api/admin/advent/metrics", { auth: operator })))).analytics;
    expect(cached).toMatchObject({ generatedAt: first.generatedAt, kpis: { players: 1 } });
    const csv = await (await getReportCsv(request("/api/admin/advent/report/days.csv", { auth: operator }), ctx({ name: "days.csv" }))).text();
    expect(csv.split("\r\n").find((line) => line.startsWith('"4"'))).toContain('"1","0","1"');
    clock.value = new Date(clock.value.getTime() + ANALYTICS_TTL_MS);
    const fresh = (await json(await getMetrics(request("/api/admin/advent/metrics", { auth: operator })))).analytics;
    expect(fresh.kpis.players).toBe(2);
    expect(fresh.generatedAt).toBe(clock.value.toISOString());
  });

  it("seed-demo на PostgreSQL: детерминированные участники, метрики сходятся с таблицами", async () => {
    const prisma = getPrisma();
    const advent = adventConfig();
    await prisma.campaign.upsert({ where: { slug: advent.slug }, update: {}, create: { slug: advent.slug, title: advent.title } });
    const repository = new PrismaAdventRepository(prisma);
    const rewards = new RewardService(repository, advent, { qrSecret: "integration-seed-secret-0123456789abcdef0123", baseUrl: "https://demo.example.test", rng: seededRandom(3) });
    const service = new AdventService(repository, advent, rewards);
    const report = await seedDemoAdvent({ repository, service, advent }, { participants: 40, seed: 3, through: at(6, 20) });
    expect(report.participants).toBe(40);
    const data = await loadAdventAnalytics(repository, advent, at(6, 20), await rewards.overview());
    expect(data.kpis.participants).toBe(40);
    expect(data.kpis.players).toBe(await prisma.participant.count({ where: { campaignSlug: advent.slug, dayOpens: { some: {} } } }));
    expect(data.days.reduce((sum, day) => sum + day.opened, 0)).toBe(await prisma.dayOpen.count({ where: { participant: { campaignSlug: advent.slug } } }));
    // Адреса — только на зарезервированном домене демо-данных.
    const emails = await prisma.participant.findMany({ where: { campaignSlug: advent.slug, normalizedEmail: { not: null } }, select: { normalizedEmail: true } });
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((row) => row.normalizedEmail!.endsWith("@seed.example.test"))).toBe(true);
  });
});
