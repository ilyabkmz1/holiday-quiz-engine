import { NextRequest } from "next/server";

import { campaign } from "@tenants/demo-office/campaign";
import type { Task } from "@/config/schema";
import { SESSION_COOKIE } from "@/server/api";
import { overrideServices } from "@/server/container";

import { OPEN_NOW, TEST_ADMIN_PASSWORD, TEST_ADMIN_USERNAME, TEST_APP_URL } from "./constants";
import { sensitiveValues } from "./leak-guard";
import { correctPayload } from "../../support/solve";

import { GET as healthGET } from "@/app/api/health/route";
import { POST as createSession } from "@/app/api/sessions/route";
import { GET as getSession } from "@/app/api/sessions/[id]/route";
import { POST as postEnterRoom } from "@/app/api/sessions/[id]/rooms/[roomId]/enter/route";
import { GET as getRoomTask } from "@/app/api/sessions/[id]/rooms/[roomId]/task/route";
import { POST as postAnswer } from "@/app/api/sessions/[id]/answers/route";
import { POST as postRushStart } from "@/app/api/sessions/[id]/rush/start/route";
import { POST as postRushAnswer } from "@/app/api/sessions/[id]/rush/answer/route";
import { POST as postRushFinish } from "@/app/api/sessions/[id]/rush/finish/route";
import { POST as postComplete } from "@/app/api/sessions/[id]/complete/route";
import { POST as postClaim } from "@/app/api/sessions/[id]/claim/route";
import { GET as verifyClaim } from "@/app/api/claims/verify/route";

export { healthGET };

export const allTasks = campaign.rooms.flatMap((room) => room.tasks);
export const rooms = campaign.rooms;

/** Управляемые часы приложения: время двигают явно, а не ждут. */
export const clock = {
  value: OPEN_NOW,
  set(next: Date): void {
    clock.value = new Date(next);
  },
  advance(milliseconds: number): void {
    clock.value = new Date(clock.value.getTime() + milliseconds);
  }
};

export type SentMail = { email: string; link: string; token: string };

export class FakeMailer {
  readonly sent: SentMail[] = [];
  failNext = 0;

  readonly send = async (email: string, link: string): Promise<void> => {
    // Секреты регистрируются сразу: любой вывод в console.* с ними уронит тест.
    const token = new URL(link).searchParams.get("token") ?? "";
    sensitiveValues.add(token);
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error("SMTP unavailable");
    }
    this.sent.push({ email, link, token });
  };
}

export function installFakes(now: Date = OPEN_NOW, random?: () => number): FakeMailer {
  const mailer = new FakeMailer();
  clock.set(now);
  overrideServices({ now: () => new Date(clock.value), sendVerification: mailer.send, random });
  return mailer;
}

type RequestOptions = {
  method?: string;
  cookie?: string | null;
  origin?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
};

export function makeRequest(path: string, options: RequestOptions = {}): NextRequest {
  const headers = new Headers(options.headers);
  const method = options.method ?? "GET";
  const origin = options.origin === undefined && method !== "GET" ? TEST_APP_URL : options.origin;
  if (origin) headers.set("origin", origin);
  if (options.cookie) headers.set("cookie", `${SESSION_COOKIE}=${options.cookie}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(new URL(path, TEST_APP_URL), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
}

export function adminHeaders(password = TEST_ADMIN_PASSWORD, username = TEST_ADMIN_USERNAME) {
  return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const roomCtx = (id: string, roomId: string) => ({ params: Promise.resolve({ id, roomId }) });

export type Player = { sessionId: string; accessKey: string };

export async function startSession(): Promise<Player> {
  const response = await createSession(makeRequest("/api/sessions", { method: "POST" }));
  if (response.status !== 200) throw new Error(`session start failed: ${response.status}`);
  const body = (await response.json()) as { sessionId: string };
  const accessKey = response.cookies.get(SESSION_COOKIE)?.value;
  if (!accessKey) throw new Error("no session cookie");
  sensitiveValues.add(accessKey);
  return { sessionId: body.sessionId, accessKey };
}

type Cookie = string | null;

export const api = {
  createSession: (options: RequestOptions = {}) =>
    createSession(makeRequest("/api/sessions", { method: "POST", ...options })),
  getSession: (id: string, cookie: Cookie) =>
    getSession(makeRequest(`/api/sessions/${id}`, { cookie }), ctx(id)),
  enterRoom: (id: string, cookie: Cookie, roomId: string, options: RequestOptions = {}) =>
    postEnterRoom(makeRequest(`/api/sessions/${id}/rooms/${roomId}/enter`, { method: "POST", cookie, ...options }), roomCtx(id, roomId)),
  roomTask: (id: string, cookie: Cookie, roomId: string, answeredTaskId?: string) =>
    getRoomTask(
      makeRequest(`/api/sessions/${id}/rooms/${roomId}/task${answeredTaskId ? `?taskId=${answeredTaskId}` : ""}`, { cookie }),
      roomCtx(id, roomId)
    ),
  answer: (id: string, cookie: Cookie, taskId: string, payload: unknown, options: RequestOptions = {}) =>
    postAnswer(
      makeRequest(`/api/sessions/${id}/answers`, { method: "POST", cookie, body: { taskId, payload }, ...options }),
      ctx(id)
    ),
  rushStart: (id: string, cookie: Cookie, options: RequestOptions = {}) =>
    postRushStart(makeRequest(`/api/sessions/${id}/rush/start`, { method: "POST", cookie, ...options }), ctx(id)),
  rushAnswer: (id: string, cookie: Cookie, itemId: string, serviceId: string, options: RequestOptions = {}) =>
    postRushAnswer(
      makeRequest(`/api/sessions/${id}/rush/answer`, { method: "POST", cookie, body: { itemId, serviceId }, ...options }),
      ctx(id)
    ),
  rushFinish: (id: string, cookie: Cookie, options: RequestOptions = {}) =>
    postRushFinish(makeRequest(`/api/sessions/${id}/rush/finish`, { method: "POST", cookie, ...options }), ctx(id)),
  complete: (id: string, cookie: Cookie, options: RequestOptions = {}) =>
    postComplete(makeRequest(`/api/sessions/${id}/complete`, { method: "POST", cookie, ...options }), ctx(id)),
  claim: (id: string, cookie: Cookie, body: unknown, options: RequestOptions = {}) =>
    postClaim(makeRequest(`/api/sessions/${id}/claim`, { method: "POST", cookie, body, ...options }), ctx(id)),
  verify: (token: string | null) =>
    verifyClaim(makeRequest(token === null ? "/api/claims/verify" : `/api/claims/verify?token=${encodeURIComponent(token)}`))
};

async function expectOk(response: Response, what: string): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (response.status !== 200) throw new Error(`${what} failed: ${response.status}`);
  return response.json();
}

/** Вход в комнату и ответы на три её задания; `payloadFor` выбирает ответ, по умолчанию верный. */
export async function playRoom(
  player: Player,
  roomId: string,
  options: { payloadFor?: (task: Task, index: number) => unknown; secondsPerTask?: number } = {}
): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const room = campaign.rooms.find((candidate) => candidate.id === roomId)!;
  await expectOk(await api.enterRoom(player.sessionId, player.accessKey, roomId), "enter room");
  let last: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const [index, task] of room.tasks.entries()) {
    // Показ задания запускает его время; на ответ уходит `secondsPerTask`.
    await expectOk(await api.roomTask(player.sessionId, player.accessKey, roomId), "room task");
    clock.advance((options.secondsPerTask ?? 0) * 1000);
    const payload = options.payloadFor ? options.payloadFor(task, index) : correctPayload(task);
    last = await expectOk(await api.answer(player.sessionId, player.accessKey, task.id, payload), "answer");
  }
  return last;
}

export async function playAllRooms(player: Player, options: Parameters<typeof playRoom>[2] = {}): Promise<void> {
  for (const room of campaign.rooms) await playRoom(player, room.id, options);
}

export function serviceFor(itemId: string): string {
  return campaign.rush.pool.find((item) => item.id === itemId)!.serviceId;
}

export function wrongServiceFor(itemId: string): string {
  return campaign.rush.services.find((service) => service.id !== serviceFor(itemId))!.id;
}

/** Старт рывка; возвращает его состояние. */
export async function startRush(player: Player): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (await expectOk(await api.rushStart(player.sessionId, player.accessKey), "rush start")).rush;
}

/**
 * Полное прохождение с верными ответами: пять комнат (время на задания не тратится),
 * рывок без ответов и финализация. При неподвижных часах счёт равен PERFECT_FIXED_CLOCK_SCORE.
 */
export async function completedPlayer(): Promise<Player> {
  const player = await startSession();
  await playAllRooms(player);
  await startRush(player);
  await expectOk(await api.rushFinish(player.sessionId, player.accessKey), "rush finish");
  await expectOk(await api.complete(player.sessionId, player.accessKey), "complete");
  return player;
}

/** 15 × 100 + комбо (0, 25, 50 и 12 × 75) + 5 × 50 за комнаты без сбоев + 5 × 150 за скорость при неподвижных часах. */
export const PERFECT_FIXED_CLOCK_SCORE = 1500 + 975 + 250 + 750;

export type ClaimFormInput = { name: string; email: string; company: string; consent: boolean };

export function claimInput(overrides: Partial<ClaimFormInput> = {}): ClaimFormInput {
  const input = {
    name: "Мария Тестова",
    email: "Maria.Test@Example.COM",
    company: "ООО Тестовая Компания",
    consent: true,
    ...overrides
  };
  for (const value of [input.name, input.email, input.email.trim().toLowerCase(), input.company]) {
    sensitiveValues.add(value);
  }
  return input;
}

import { GET as adminMetrics } from "@/app/api/admin/metrics/route";
import { GET as adminClaimsCsv } from "@/app/api/admin/claims.csv/route";
import { POST as adminClaimsExport } from "@/app/api/admin/claims/export/route";
import { GET as readyGET } from "@/app/api/ready/route";

export { adminMetrics, adminClaimsCsv, adminClaimsExport, readyGET };

/** Как кнопка в админке: POST «отметить выгруженными» с Origin сайта и Basic-паролем оператора. */
export function markClaimsExported(): Promise<Response> {
  return adminClaimsExport(makeRequest("/api/admin/claims/export", { method: "POST", headers: adminHeaders() }));
}

/** Игрок проходит квиз, оставляет заявку и переходит по ссылке из письма. */
export async function verifiedClaim(mailer: FakeMailer, overrides: Partial<ClaimFormInput> = {}) {
  const player = await completedPlayer();
  const input = claimInput(overrides);
  const response = await api.claim(player.sessionId, player.accessKey, input);
  if (response.status !== 200) throw new Error(`claim failed: ${response.status}`);
  const mail = mailer.sent.at(-1)!;
  const verified = await api.verify(mail.token);
  if (verified.status !== 307) throw new Error(`verify failed: ${verified.status}`);
  return { player, input, mail };
}

/** Тело JSON-ответа; поля проверяются в самих тестах. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function json(response: Response): Promise<Record<string, any>> {
  return response.json();
}
