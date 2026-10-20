import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADVENT_COOKIE } from "@/server/advent-api";
import { overrideServices, getAdventServices } from "@/server/container";
import { hashToken } from "@/server/crypto";
import { getPrisma } from "@/server/db";
import type { MailVars } from "@/server/mailer";
import { DEFAULT_REMINDER_OPTIONS } from "@/server/services/reminder-service";
import { identityRequestIpRateLimiter, identityRequestParticipantRateLimiter } from "@/server/rate-limit";
import { findTenant, isAdventTenant, loadTenants, overrideTenants } from "@/server/tenants";

import { GET as adminMetrics } from "@/app/api/admin/advent/metrics/route";
import { POST as createParticipant } from "@/app/api/advent/participants/route";
import { POST as postIdentityRequest } from "@/app/api/advent/identity/request/route";
import { POST as postIdentityVerify } from "@/app/api/advent/identity/verify/route";
import { POST as postReminders } from "@/app/api/advent/reminders/route";
import { GET as openFromEmail } from "@/app/api/advent/reminders/open/route";
import { POST as postUnsubscribe } from "@/app/api/advent/unsubscribe/route";
import { POST as postOneClick } from "@/app/api/advent/unsubscribe/one-click/route";

import { adventPackFixture } from "../fixtures/advent";
import { at } from "../support/advent";
import { TEST_ADMIN_PASSWORD, TEST_ADMIN_USERNAME } from "./helpers/constants";
import { sensitiveValues } from "./helpers/leak-guard";

const HOST = "advent.test";
const clock = { value: at(2, 9) };
const sent: Array<{ email: string; vars: MailVars["reminder"] }> = [];
const loginTokens: string[] = [];

function request(path: string, init: { method?: string; cookie?: string | null; body?: unknown; form?: Record<string, string>; origin?: boolean; auth?: string } = {}): NextRequest {
  const method = init.method ?? "GET";
  const headers = new Headers({ host: HOST });
  if (method !== "GET" && init.origin !== false) headers.set("origin", `http://${HOST}`);
  if (init.cookie) headers.set("cookie", `${ADVENT_COOKIE}=${init.cookie}`);
  if (init.auth) headers.set("authorization", init.auth);
  let body: string | undefined;
  if (init.form) {
    headers.set("content-type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(init.form).toString();
  } else if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  return new NextRequest(new URL(path, `http://${HOST}`), { method, headers, body });
}

const json = (response: Response) => response.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Участник с подтверждённым email; возвращает cookie устройства. */
async function subscriber(email: string, reminderOptIn = true): Promise<{ cookie: string; participantId: string }> {
  // Подготовка десятков подписчиков идёт с одного адреса: лимит запросов ссылки (5 в минуту) здесь не предмет проверки.
  identityRequestIpRateLimiter.reset();
  identityRequestParticipantRateLimiter.reset();
  const created = await createParticipant(request("/api/advent/participants", { method: "POST" }));
  const anonymous = created.cookies.get(ADVENT_COOKIE)!.value;
  const requested = await postIdentityRequest(request("/api/advent/identity/request", { method: "POST", cookie: anonymous, body: { email, consent: true, reminderOptIn } }));
  expect(requested.status).toBe(200);
  const confirmed = await postIdentityVerify(request("/api/advent/identity/verify", { method: "POST", cookie: anonymous, form: { token: loginTokens.at(-1)! } }));
  return { cookie: confirmed.cookies.get(ADVENT_COOKIE)!.value, participantId: (await json(created)).participantId };
}

function reminderService() {
  const tenant = findTenant(HOST);
  if (!tenant || !isAdventTenant(tenant)) throw new Error("нет арендатора");
  return getAdventServices(tenant, { reminderOptions: { ...DEFAULT_REMINDER_OPTIONS, ratePerSecond: 0, batchSize: 7 } }).reminderService;
}

describe("напоминания адвента на PostgreSQL", () => {
  beforeEach(() => {
    clock.value = at(2, 9);
    sent.length = 0;
    loginTokens.length = 0;
    overrideServices({
      now: () => new Date(clock.value),
      sendLogin: async (email, link) => {
        const token = new URL(link).searchParams.get("token")!;
        sensitiveValues.add(token);
        sensitiveValues.add(email);
        loginTokens.push(token);
      },
      sendReminder: async (email, vars) => {
        sensitiveValues.add(email);
        sensitiveValues.add(new URL(vars.link).searchParams.get("token")!);
        sensitiveValues.add(new URL(vars.unsubscribeUrl).searchParams.get("t")!);
        sent.push({ email, vars });
      }
    });
    overrideTenants(loadTenants([{ ...adventPackFixture(), hosts: [HOST] }]));
  });
  afterEach(() => overrideTenants(null));

  it("два параллельных запуска не шлют дублей: 24 подписчика, 24 письма, по одной доставке на участника", async () => {
    for (let index = 0; index < 24; index += 1) await subscriber(`runner${index}@example.test`);
    await subscriber("silent@example.test", false);

    const results = await Promise.all([reminderService().run(clock.value), reminderService().run(clock.value), reminderService().run(clock.value)]);

    expect(sent).toHaveLength(24);
    expect(new Set(sent.map((item) => item.email)).size).toBe(24);
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(24);
    expect(results.reduce((sum, result) => sum + result.failed, 0)).toBe(0);
    const prisma = getPrisma();
    const deliveries = await prisma.reminderDelivery.findMany();
    expect(deliveries).toHaveLength(24);
    expect(deliveries.every((delivery) => delivery.status === "sent" && delivery.attempts === 1 && delivery.sentAt && delivery.lastError === null)).toBe(true);
    // В БД только хеши токенов: ни токена входа, ни токена отписки в открытом виде.
    const tokens = await prisma.loginToken.findMany({ where: { trusted: true } });
    expect(tokens).toHaveLength(24);
    for (const mail of sent) {
      const loginToken = new URL(mail.vars.link).searchParams.get("token")!;
      const unsubscribe = new URL(mail.vars.unsubscribeUrl).searchParams.get("t")!;
      expect(tokens.some((token) => token.tokenHash === hashToken(loginToken))).toBe(true);
      expect(deliveries.some((delivery) => delivery.unsubscribeHash === hashToken(unsubscribe))).toBe(true);
      expect(deliveries.some((delivery) => delivery.unsubscribeHash === unsubscribe)).toBe(false);
    }
    // Повторный запуск того же дня ничего не шлёт.
    expect(await reminderService().run(new Date(clock.value.getTime() + 15 * 60_000))).toMatchObject({ sent: 0, claimed: 0 });
    expect(sent).toHaveLength(24);
  });

  it("ошибка отправки: failed с кодом без адреса, повтор в следующий запуск, затем sent", async () => {
    const { participantId } = await subscriber("flaky@example.test");
    let fail = true;
    overrideServices({
      now: () => new Date(clock.value),
      sendLogin: async () => undefined,
      sendReminder: async (email, vars) => {
        if (fail) throw Object.assign(new Error(`550 ${email} rejected`), { code: "EENVELOPE" });
        sent.push({ email, vars });
      }
    });
    expect(await reminderService().run(clock.value)).toMatchObject({ failed: 1, sent: 0 });
    const prisma = getPrisma();
    expect(await prisma.reminderDelivery.findFirstOrThrow({ where: { participantId } })).toMatchObject({ status: "failed", attempts: 1, lastError: "smtp_eenvelope", sentAt: null });

    expect(await reminderService().run(new Date(clock.value.getTime() + 5 * 60_000))).toMatchObject({ claimed: 0 });
    fail = false;
    const later = new Date(clock.value.getTime() + 15 * 60_000);
    expect(await reminderService().run(later)).toMatchObject({ sent: 1, claimed: 1 });
    expect(await prisma.reminderDelivery.findFirstOrThrow({ where: { participantId } })).toMatchObject({ status: "sent", attempts: 2, lastError: null, sentAt: later });
    expect(sent).toHaveLength(1);
  });

  it("путь из письма: кнопка → вход → фасад, переход один раз; метрики; отписка по ссылке и one-click; повторный запуск не шлёт", async () => {
    const { participantId } = await subscriber("path@example.test");
    const other = await subscriber("other@example.test");
    await reminderService().run(clock.value);
    expect(sent).toHaveLength(2);
    const mail = sent.find((item) => item.email === "path@example.test")!.vars;
    const button = new URL(mail.link);
    const deliveryId = button.searchParams.get("r")!;

    // Кнопка на чужом устройстве → страница входа; клик не засчитан.
    const first = await openFromEmail(request(`${button.pathname}${button.search}`));
    const login = new URL(first.headers.get("location")!);
    expect(login.pathname).toBe("/login");
    const prisma = getPrisma();
    expect((await prisma.reminderDelivery.findUniqueOrThrow({ where: { id: deliveryId } })).clickedAt).toBeNull();

    // Войти → сайт на дне письма; вход с нового устройства не отзывает прежние ключи.
    const confirmed = await postIdentityVerify(request("/api/advent/identity/verify", { method: "POST", form: { token: login.searchParams.get("token")!, r: deliveryId } }));
    expect(new URL(confirmed.headers.get("location")!).search).toBe("?day=2");
    expect((await prisma.reminderDelivery.findUniqueOrThrow({ where: { id: deliveryId } })).clickedAt).toEqual(clock.value);
    expect(await prisma.participantKey.count({ where: { participantId } })).toBeGreaterThanOrEqual(2);

    // Открыл день после письма → метрики.
    clock.value = at(2, 9, 20);
    const tenant = findTenant(HOST);
    if (!tenant || !isAdventTenant(tenant)) throw new Error("нет арендатора");
    await getAdventServices(tenant).adventService.openDay(participantId, 2, clock.value);
    const auth = `Basic ${Buffer.from(`${TEST_ADMIN_USERNAME}:${TEST_ADMIN_PASSWORD}`).toString("base64")}`;
    const metrics = await json(await adminMetrics(request("/api/admin/advent/metrics", { auth })));
    expect(metrics.reminders).toMatchObject({ channel: "email", subscribed: 2, unsubscribed: 0 });
    expect(metrics.reminders.days[1]).toMatchObject({ day: 2, sent: 2, failed: 0, clicked: 1, openedAfter: 1 });
    expect(JSON.stringify(metrics)).not.toContain("@");
    expect((await adminMetrics(request("/api/admin/advent/metrics"))).status).toBe(401);

    // Отписка ссылкой (форма) и one-click (RFC 8058) у разных участников.
    const unsubscribe = new URL(mail.unsubscribeUrl).searchParams.get("t")!;
    const page = await postUnsubscribe(request("/api/advent/unsubscribe", { method: "POST", form: { t: unsubscribe } }));
    expect(new URL(page.headers.get("location")!).search).toBe("?done=1");
    const otherMail = sent.find((item) => item.email === "other@example.test")!.vars;
    const oneClick = new URL(otherMail.unsubscribeOneClickUrl);
    const oneClickResponse = await postOneClick(request(`${oneClick.pathname}${oneClick.search}`, { method: "POST", origin: false, form: { "List-Unsubscribe": "One-Click" } }));
    expect(oneClickResponse.status).toBe(200);
    expect(await prisma.participant.findMany({ where: { reminderOptIn: true } })).toHaveLength(0);
    expect(await prisma.participant.findUniqueOrThrow({ where: { id: participantId } })).toMatchObject({ unsubscribedAt: clock.value, consentAt: expect.any(Date), normalizedEmail: "path@example.test" });
    const after = await json(await adminMetrics(request("/api/admin/advent/metrics", { auth })));
    expect(after.reminders).toMatchObject({ subscribed: 0, unsubscribed: 2 });

    // Следующий день: отписавшимся письма нет; включение на сайте возвращает рассылку.
    clock.value = at(3, 9);
    expect(await reminderService().run(clock.value)).toMatchObject({ sent: 0, claimed: 0 });
    const on = await postReminders(request("/api/advent/reminders", { method: "POST", cookie: other.cookie, body: { enabled: true } }));
    expect((await json(on)).state.participant.reminderOptIn).toBe(true);
    expect(await reminderService().run(clock.value)).toMatchObject({ sent: 1 });
    expect(sent.at(-1)?.email).toBe("other@example.test");
  });

  it("очистка ПДн стирает токены отписки и отметки, доставки остаются обезличенными", async () => {
    const { participantId } = await subscriber("erase@example.test");
    await reminderService().run(clock.value);
    const prisma = getPrisma();
    const tenant = findTenant(HOST);
    if (!tenant || !isAdventTenant(tenant)) throw new Error("нет арендатора");
    await getAdventServices(tenant).repository.anonymizeCampaignParticipants(tenant.advent.slug);
    expect(await prisma.participant.findUniqueOrThrow({ where: { id: participantId } })).toMatchObject({ normalizedEmail: null, reminderOptIn: false, unsubscribeHash: null, unsubscribedAt: null });
    const delivery = await prisma.reminderDelivery.findFirstOrThrow({ where: { participantId } });
    expect(delivery.unsubscribeHash).toBeNull();
    expect(delivery.status).toBe("sent");
    expect(await prisma.loginToken.count({ where: { participantId } })).toBe(0);
  });
});
