import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adventSchema } from "@/config/advent-schema";
import { correctPayload } from "@/domain/solve";
import { signTelegramInitData } from "@/platform/telegram-init-data";
import { overrideServices } from "@/server/container";
import { resetRuntimeEnvCache } from "@/server/env";
import { getPrisma } from "@/server/db";
import { loadTenants, overrideTenants } from "@/server/tenants";

import { POST as createParticipant } from "@/app/api/advent/participants/route";
import { GET as getState } from "@/app/api/advent/state/route";
import { POST as postOpen } from "@/app/api/advent/days/[n]/open/route";
import { POST as postBlock } from "@/app/api/advent/days/[n]/blocks/[i]/route";
import { POST as postVisit } from "@/app/api/advent/platform/visit/route";

import { adventFixture, adventPackFixture } from "../fixtures/advent";
import { at } from "../support/advent";
import { sensitiveValues } from "./helpers/leak-guard";

const HOST = "advent.test";
const BOT_TOKEN = "123456789:TEST-integration-bot-token-0000000000";
const SECRET = "integration-platform-id-secret-0123456789abcdef";
const advent = adventSchema.parse(adventFixture());
const clock = { value: at(4, 12) };

function request(path: string, init: { method?: string; initData?: string; body?: unknown } = {}): NextRequest {
  const method = init.method ?? "GET";
  const headers = new Headers({ host: HOST });
  if (method !== "GET") headers.set("origin", `http://${HOST}`);
  if (init.initData) headers.set("x-telegram-init-data", init.initData);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(new URL(path, `http://${HOST}`), { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const json = (response: Response) => response.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function initDataFor(userId: number, extra: Record<string, string> = {}): string {
  const data = signTelegramInitData(
    { auth_date: String(Math.floor(clock.value.getTime() / 1000) - 30), user: JSON.stringify({ id: userId, first_name: "Имя", username: "nickname" }), ...extra },
    BOT_TOKEN
  );
  sensitiveValues.add(data);
  return data;
}

const join = (initData: string, body: unknown = { consent: true }) => createParticipant(request("/api/advent/participants", { method: "POST", initData, body }));

describe("адвент в Telegram: маршруты на PostgreSQL", () => {
  beforeEach(() => {
    clock.value = at(4, 12);
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    process.env.PLATFORM_ID_SECRET = SECRET;
    resetRuntimeEnvCache();
    sensitiveValues.add(BOT_TOKEN);
    sensitiveValues.add(SECRET);
    overrideServices({ now: () => new Date(clock.value) });
    overrideTenants(loadTenants([{ ...adventPackFixture(), hosts: [HOST], platforms: { telegram: { botUsername: "zerno_advent_bot", appShortName: "advent" } } }]));
  });
  afterEach(() => {
    overrideTenants(null);
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.PLATFORM_ID_SECRET;
    resetRuntimeEnvCache();
  });

  it("гонка: параллельные первые запросы одного пользователя создают одного участника и одну идентичность", async () => {
    const initData = initDataFor(8001);
    const responses = await Promise.all(Array.from({ length: 6 }, () => join(initData)));
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const ids = new Set(await Promise.all(responses.map(async (response) => (await json(response)).participantId)));
    expect(ids.size).toBe(1);
    const prisma = getPrisma();
    expect(await prisma.participant.count()).toBe(1);
    expect(await prisma.participantIdentity.count()).toBe(1);
  });

  it("в БД только псевдоним: ни сырого id, ни имени, ни username; согласие записано; платформа telegram", async () => {
    const response = await join(initDataFor(424242));
    const { participantId } = await json(response);
    const prisma = getPrisma();
    const participant = await prisma.participant.findUniqueOrThrow({ where: { id: participantId }, include: { identities: true } });
    expect(participant).toMatchObject({ platform: "telegram", normalizedEmail: null });
    expect(participant.consentAt).toEqual(clock.value);
    expect(participant.identities).toHaveLength(1);
    expect(participant.identities[0].subjectHash).toMatch(/^[0-9a-f]{64}$/);
    const dump = JSON.stringify([participant, await prisma.auditEvent.findMany()]);
    for (const secret of ["424242", "nickname", "Имя"]) expect(dump).not.toContain(secret);
  });

  it("без согласия участник не создаётся", async () => {
    expect((await join(initDataFor(8002), {})).status).toBe(409);
    expect((await join(initDataFor(8002), { consent: "yes" })).status).toBe(409);
    expect(await getPrisma().participant.count()).toBe(0);
    expect((await getState(request("/api/advent/state", { initData: initDataFor(8002) }))).status).toBe(401);
  });

  it("промокод и удача выдаются без email: код назначен сразу, остаток удачи списан один раз", async () => {
    const initData = initDataFor(8003);
    const { participantId } = await json(await join(initData));
    expect((await postOpen(request("/api/advent/days/4/open", { method: "POST", initData }), ctx({ n: "4" }))).status).toBe(200);
    const day = advent.days.find((candidate) => candidate.n === 4)!;
    let reward: { code: string | null; needsIdentity: boolean } | null = null;
    for (const [index, item] of day.blocks.entries()) {
      const payload = item.type === "task" ? correctPayload(item.task) : item.type === "luck" ? { choice: 0 } : undefined;
      const response = await postBlock(
        request(`/api/advent/days/4/blocks/${index}`, { method: "POST", initData, body: payload === undefined ? undefined : { payload } }),
        ctx({ n: "4", i: String(index) })
      );
      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.status).toBe("ok");
      if (item.type === "luck") reward = body.block.reward;
    }
    expect(reward?.needsIdentity).toBe(false);
    expect(reward?.code).toBeTruthy();
    const prisma = getPrisma();
    expect(await prisma.participant.findUniqueOrThrow({ where: { id: participantId } })).toMatchObject({ normalizedEmail: null });
    expect((await prisma.rewardGrant.findMany({ where: { participantId, source: "luck" } })).filter((grant) => grant.code)).toHaveLength(1);
  });

  it("один Telegram-аккаунт — один участник: повторный вход с новым initData возвращает прогресс", async () => {
    const first = await json(await join(initDataFor(8004)));
    await postOpen(request("/api/advent/days/4/open", { method: "POST", initData: initDataFor(8004) }), ctx({ n: "4" }));
    const again = await join(initDataFor(8004, { query_id: "AAHnew" }));
    expect((await json(again)).participantId).toBe(first.participantId);
    const state = await json(await getState(request("/api/advent/state", { initData: initDataFor(8004, { query_id: "third" }) })));
    expect(state.doors.find((door: { n: number }) => door.n === 4).status).toBe("opened");
  });

  it("метка источника считается по дням агрегатом", async () => {
    await postVisit(request("/api/advent/platform/visit", { method: "POST", initData: initDataFor(1, { start_param: "d4_s_channel" }), body: {} }));
    await postVisit(request("/api/advent/platform/visit", { method: "POST", initData: initDataFor(2, { start_param: "s_channel" }), body: {} }));
    const rows = await getPrisma().adventSourceVisit.findMany();
    expect(rows).toMatchObject([{ campaignSlug: advent.slug, source: "channel", opens: 2 }]);
  });
});
