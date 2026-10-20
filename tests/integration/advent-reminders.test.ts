import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADVENT_COOKIE } from "@/server/advent-api";
import { overrideServices, getAdventServices } from "@/server/container";
import { hashToken } from "@/server/crypto";
import { getPrisma } from "@/server/db";
import type { MailVars } from "@/server/mailer";
import { DEFAULT_REMINDER_OPTIONS } from "@/server/services/reminder-service";
import { identityRequestEmailRateLimiter, identityRequestIpRateLimiter, identityRequestParticipantRateLimiter, reminderLoginDeliveryRateLimiter } from "@/server/rate-limit";
import { findTenant, isAdventTenant, loadTenants, overrideTenants } from "@/server/tenants";

import { GET as adminMetrics } from "@/app/api/admin/advent/metrics/route";
import { POST as createParticipant } from "@/app/api/advent/participants/route";
import { POST as postIdentityRequest } from "@/app/api/advent/identity/request/route";
import { POST as postIdentityVerify } from "@/app/api/advent/identity/verify/route";
import { POST as postReminders } from "@/app/api/advent/reminders/route";
import { GET as openFromEmail } from "@/app/api/advent/reminders/open/route";
import { POST as postReminderLogin } from "@/app/api/advent/reminders/login/route";
import { GET as getState } from "@/app/api/advent/state/route";
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
/** Письма со ссылкой входа: кому и какая ссылка (проверяем, что ссылка со страницы письма уходит владельцу). */
const loginMails: Array<{ email: string; link: string }> = [];

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
  const requested = await postIdentityRequest(request("/api/advent/identity/request", { method: "POST", cookie: anonymous, body: { email, consent: true, marketingConsent: reminderOptIn, reminderOptIn } }));
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
    loginMails.length = 0;
    reminderLoginDeliveryRateLimiter.reset();
    identityRequestEmailRateLimiter.reset();
    overrideServices({
      now: () => new Date(clock.value),
      sendLogin: async (email, link) => {
        const token = new URL(link).searchParams.get("token")!;
        sensitiveValues.add(token);
        sensitiveValues.add(email);
        loginTokens.push(token);
        loginMails.push({ email, link });
      },
      sendReminder: async (email, vars) => {
        sensitiveValues.add(email);
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
    // Входа по ссылке письма нет: письмо не создаёт ссылок входа, в кнопке — только идентификатор доставки.
    expect(await prisma.loginToken.count({ where: { usedAt: null } })).toBe(0);
    for (const mail of sent) {
      const button = new URL(mail.vars.link);
      expect([...button.searchParams.keys()]).toEqual(["r"]);
      expect(deliveries.some((delivery) => delivery.id === button.searchParams.get("r"))).toBe(true);
      // В БД только хеш токена отписки.
      const unsubscribe = new URL(mail.vars.unsubscribeUrl).searchParams.get("t")!;
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

  it("путь из письма: cookie есть → сразу на день; нет → страница → свежая ссылка на адрес владельца → вход; метрики; отписка отзывает согласие на рассылку", async () => {
    const owner = await subscriber("path@example.test");
    const { participantId } = owner;
    const other = await subscriber("other@example.test");
    // Только отметка без согласия на рассылку письма не даёт (сервер её и не примет).
    const refused = await postIdentityRequest(request("/api/advent/identity/request", { method: "POST", cookie: other.cookie, body: { email: "x@example.test", consent: true, reminderOptIn: true } }));
    expect(refused.status).toBe(400);
    loginMails.length = 0;
    await reminderService().run(clock.value);
    expect(sent).toHaveLength(2);
    const mail = sent.find((item) => item.email === "path@example.test")!.vars;
    const button = new URL(mail.link);
    const deliveryId = button.searchParams.get("r")!;
    const prisma = getPrisma();
    const clickedAt = async (id: string) => (await prisma.reminderDelivery.findUniqueOrThrow({ where: { id } })).clickedAt;

    // Своё устройство (cookie того же участника) → сразу на день письма, переход засчитан.
    const otherMail = sent.find((item) => item.email === "other@example.test")!.vars;
    const otherButton = new URL(otherMail.link);
    const direct = await openFromEmail(request(`${otherButton.pathname}${otherButton.search}`, { cookie: other.cookie }));
    expect(new URL(direct.headers.get("location")!).search).toBe("?day=2");
    expect(await clickedAt(otherButton.searchParams.get("r")!)).toEqual(clock.value);

    // Чужое устройство (пересланное письмо, нет cookie) → страница «войдите», входа нет, клик не засчитан, письма нет.
    const first = await openFromEmail(request(`${button.pathname}${button.search}`));
    const page = new URL(first.headers.get("location")!);
    expect(page.pathname).toBe("/reminder");
    expect(Object.fromEntries(page.searchParams)).toEqual({ r: deliveryId, d: "2" });
    expect(first.cookies.get(ADVENT_COOKIE)).toBeUndefined();
    expect(await clickedAt(deliveryId)).toBeNull();
    expect(loginMails).toHaveLength(0);

    // Кнопка без Origin не работает.
    expect((await postReminderLogin(request("/api/advent/reminders/login", { method: "POST", origin: false, form: { r: deliveryId } }))).status).toBe(403);
    expect(loginMails).toHaveLength(0);

    // «Прислать ссылку для входа»: свежая ссылка уходит на подтверждённый адрес владельца, страница адреса не знает.
    const asked = await postReminderLogin(request("/api/advent/reminders/login", { method: "POST", form: { r: deliveryId } }));
    expect(asked.status).toBe(303);
    expect(new URL(asked.headers.get("location")!).search).toBe("?sent=1");
    expect(asked.headers.get("location")).not.toContain("path@");
    expect(await clickedAt(deliveryId)).toEqual(clock.value);
    expect(loginMails).toHaveLength(1);
    expect(loginMails[0].email).toBe("path@example.test");
    const loginLink = new URL(loginMails[0].link);
    expect(loginLink.pathname).toBe("/api/advent/identity/verify");
    expect(loginLink.searchParams.get("r")).toBe(deliveryId);
    // Запросившее устройство получило анонимный cookie, но не доступ к владельцу.
    const strangerCookie = asked.cookies.get(ADVENT_COOKIE)!.value;
    expect((await json(await getState(request("/api/advent/state", { cookie: strangerCookie })))).participant.id).not.toBe(participantId);
    const token = await prisma.loginToken.findFirstOrThrow({ where: { usedAt: null } });
    expect(token).toMatchObject({ normalizedEmail: "path@example.test", reminderOptIn: false, marketingConsentAt: null });
    expect(token.expiresAt.getTime() - clock.value.getTime()).toBe(30 * 60_000);

    // Владелец открывает ссылку на этом же устройстве → вход и сайт на дне письма; прежние ключи владельца целы.
    const confirmed = await postIdentityVerify(request("/api/advent/identity/verify", { method: "POST", cookie: strangerCookie, form: { token: loginLink.searchParams.get("token")!, r: deliveryId } }));
    expect(new URL(confirmed.headers.get("location")!).search).toBe("?day=2");
    const ownerCookie = confirmed.cookies.get(ADVENT_COOKIE)!.value;
    expect((await json(await getState(request("/api/advent/state", { cookie: ownerCookie })))).participant.id).toBe(participantId);
    expect((await json(await getState(request("/api/advent/state", { cookie: owner.cookie })))).participant.id).toBe(participantId);

    // Лимит на доставку: не больше 3 писем за 15 минут с одной кнопки.
    loginMails.length = 0;
    identityRequestEmailRateLimiter.reset();
    const statuses: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      identityRequestIpRateLimiter.reset();
      const response = await postReminderLogin(request("/api/advent/reminders/login", { method: "POST", form: { r: deliveryId } }));
      statuses.push(new URL(response.headers.get("location")!).search);
    }
    expect(statuses.slice(0, 2)).toEqual(["?sent=1", "?sent=1"]);
    expect(statuses.slice(2)).toEqual([`?r=${deliveryId}&limited=1`, `?r=${deliveryId}&limited=1`]);
    expect(loginMails.every((item) => item.email === "path@example.test")).toBe(true);

    // Открыл день после письма → метрики.
    clock.value = at(2, 9, 20);
    const tenant = findTenant(HOST);
    if (!tenant || !isAdventTenant(tenant)) throw new Error("нет арендатора");
    await getAdventServices(tenant).adventService.openDay(participantId, 2, clock.value);
    const auth = `Basic ${Buffer.from(`${TEST_ADMIN_USERNAME}:${TEST_ADMIN_PASSWORD}`).toString("base64")}`;
    const metrics = await json(await adminMetrics(request("/api/admin/advent/metrics", { auth })));
    expect(metrics.reminders).toMatchObject({ channel: "email", subscribed: 2, unsubscribed: 0 });
    expect(metrics.reminders.days[1]).toMatchObject({ day: 2, sent: 2, failed: 0, clicked: 2, openedAfter: 1 });
    expect(JSON.stringify(metrics)).not.toContain("@");
    expect((await adminMetrics(request("/api/admin/advent/metrics"))).status).toBe(401);

    // Отписка ссылкой (форма) и one-click (RFC 8058) у разных участников: отзывает согласие на рассылку, не на данные.
    const unsubscribe = new URL(mail.unsubscribeUrl).searchParams.get("t")!;
    const unsubscribed = await postUnsubscribe(request("/api/advent/unsubscribe", { method: "POST", form: { t: unsubscribe } }));
    expect(new URL(unsubscribed.headers.get("location")!).search).toBe("?done=1");
    const oneClick = new URL(otherMail.unsubscribeOneClickUrl);
    const oneClickResponse = await postOneClick(request(`${oneClick.pathname}${oneClick.search}`, { method: "POST", origin: false, form: { "List-Unsubscribe": "One-Click" } }));
    expect(oneClickResponse.status).toBe(200);
    expect(await prisma.participant.findMany({ where: { OR: [{ reminderOptIn: true }, { marketingConsentAt: { not: null } }] } })).toHaveLength(0);
    expect(await prisma.participant.findUniqueOrThrow({ where: { id: participantId } })).toMatchObject({ unsubscribedAt: clock.value, marketingConsentAt: null, consentAt: expect.any(Date), normalizedEmail: "path@example.test" });
    const after = await json(await adminMetrics(request("/api/admin/advent/metrics", { auth })));
    expect(after.reminders).toMatchObject({ subscribed: 0, unsubscribed: 2 });

    // Следующий день: отписавшимся письма нет; включение на сайте — только с согласием на рассылку.
    clock.value = at(3, 9);
    expect(await reminderService().run(clock.value)).toMatchObject({ sent: 0, claimed: 0 });
    const noConsent = await postReminders(request("/api/advent/reminders", { method: "POST", cookie: other.cookie, body: { enabled: true } }));
    expect(noConsent.status).toBe(400);
    const on = await postReminders(request("/api/advent/reminders", { method: "POST", cookie: other.cookie, body: { enabled: true, marketingConsent: true } }));
    expect((await json(on)).state.participant).toMatchObject({ reminderOptIn: true, marketingConsent: true });
    expect(await prisma.participant.findUniqueOrThrow({ where: { id: other.participantId } })).toMatchObject({ marketingConsentAt: clock.value, unsubscribedAt: null });
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
    expect(await prisma.participant.findUniqueOrThrow({ where: { id: participantId } })).toMatchObject({ normalizedEmail: null, reminderOptIn: false, marketingConsentAt: null, unsubscribeHash: null, unsubscribedAt: null });
    const delivery = await prisma.reminderDelivery.findFirstOrThrow({ where: { participantId } });
    expect(delivery.unsubscribeHash).toBeNull();
    expect(delivery.status).toBe("sent");
    expect(await prisma.loginToken.count({ where: { participantId } })).toBe(0);
  });
});
