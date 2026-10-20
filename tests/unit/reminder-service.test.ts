import { describe, expect, it } from "vitest";

import { hashToken } from "@/server/crypto";
import type { ReminderMailVars } from "@/server/mail-reminder";
import { DEFAULT_REMINDER_OPTIONS, ReminderService, parseReminderOptions, reminderErrorCode, type ReminderOptions } from "@/server/services/reminder-service";

import { adventConfig, at, newAdventService, verifyParticipant } from "../support/advent";

type Sent = { email: string; vars: ReminderMailVars };

const OPTIONS: ReminderOptions = { ...DEFAULT_REMINDER_OPTIONS, ratePerSecond: 0 };

function setup(patch?: (draft: Record<string, any>) => void, options: Partial<ReminderOptions> = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const base = newAdventService(adventConfig(patch));
  const sent: Sent[] = [];
  let failWith: ((email: string) => unknown) | null = null;
  const sleeps: number[] = [];
  const reminders = new ReminderService({
    repository: base.repository,
    advent: base.advent,
    baseUrl: "https://advent.test",
    options: { ...OPTIONS, ...options },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    send: async (email, vars) => {
      const error = failWith?.(email);
      if (error) throw error;
      sent.push({ email, vars });
    }
  });
  /** Подписчик: анонимный участник → подтверждённый email и включённые напоминания. */
  async function subscriber(name: string, now = at(1, 9), optIn = true) {
    const { participant } = await base.service.createParticipant(now);
    const verified = await verifyParticipant(base, participant.id, now, `${name}@example.test`);
    if (optIn) await base.repository.setReminderOptIn(verified.id, true, now);
    return verified;
  }
  return { ...base, reminders, sent, sleeps, failWith: (fn: typeof failWith) => { failWith = fn; }, subscriber };
}

describe("ReminderService.run: кому и когда", () => {
  it("шлёт подписчику, который не открыл сегодняшний день, когда наступило время sendAtLocal", async () => {
    const { reminders, subscriber, sent } = setup();
    const person = await subscriber("anna");
    expect(await reminders.run(at(2, 8, 29))).toMatchObject({ skipped: "too_early", sent: 0 });
    expect(sent).toEqual([]);

    const result = await reminders.run(at(2, 8, 30));

    expect(result).toEqual({ skipped: null, day: 2, claimed: 1, sent: 1, failed: 0, lostClaims: 0 });
    expect(sent.map((item) => item.email)).toEqual(["anna@example.test"]);
    expect(sent[0].vars.dayNumber).toBe(2);
    expect(sent[0].vars.subject).toBe("Дверь 2 открыта: Как отличить свежий кофе от залежавшегося");
    expect(person.normalizedEmail).toBe("anna@example.test");
  });

  it("не шлёт: без подписки, анониму, без подтверждённого email, открывшему день, отписавшемуся", async () => {
    const { reminders, subscriber, sent, service, repository } = setup();
    await subscriber("off", at(1, 9), false);
    await service.createParticipant(at(1, 9));
    const opened = await subscriber("opened");
    await service.openDay(opened.id, 2, at(2, 8, 0));
    const gone = await subscriber("gone");
    await repository.setReminderOptIn(gone.id, false, at(2, 7));
    const kept = await subscriber("kept");

    await reminders.run(at(2, 10));

    expect(sent.map((item) => item.email)).toEqual(["kept@example.test"]);
    expect(kept.id).toBeTruthy();
  });

  it("если вчерашний день открыт, а сегодняшний нет — письмо уходит (шлём о сегодняшнем дне)", async () => {
    const { reminders, subscriber, sent, service } = setup();
    const person = await subscriber("streak");
    await service.openDay(person.id, 1, at(1, 12));
    await reminders.run(at(2, 11));
    expect(sent).toHaveLength(1);
    expect(sent[0].vars.dayNumber).toBe(2);
  });

  it("вне фазы running и при channel off писем нет", async () => {
    const { reminders, subscriber, sent } = setup();
    await subscriber("early", at(1, 9));
    expect(await reminders.run(new Date("2026-12-19T12:00:00+03:00"))).toMatchObject({ skipped: "not_running" });
    expect(await reminders.run(new Date("2027-01-01T12:00:00+03:00"))).toMatchObject({ skipped: "not_running" });
    expect(await reminders.run(new Date("2027-02-01T12:00:00+03:00"))).toMatchObject({ skipped: "not_running" });
    expect(sent).toEqual([]);

    const off = setup((draft) => {
      draft.reminders.channel = "off";
    });
    await off.subscriber("never");
    expect(await off.reminders.run(at(2, 12))).toMatchObject({ skipped: "off" });
    expect(off.sent).toEqual([]);
  });

  it("время рассылки считается по часовому поясу кампании, а не сервера", async () => {
    const { reminders, subscriber, sent } = setup((draft) => {
      draft.schedule.timezone = "Asia/Yekaterinburg"; // UTC+5: 08:30 по-местному — 03:30 UTC (06:30 по Москве)
    });
    await subscriber("ural", new Date("2026-12-20T05:00:00+05:00"));
    expect(await reminders.run(new Date("2026-12-21T08:29:00+05:00"))).toMatchObject({ skipped: "too_early" });
    expect(await reminders.run(new Date("2026-12-21T08:30:00+05:00"))).toMatchObject({ sent: 1, day: 2 });
    expect(sent).toHaveLength(1);
  });

  it("если sendAtLocal раньше часа открытия двери, письмо уходит в момент открытия", async () => {
    const { reminders, subscriber } = setup((draft) => {
      draft.schedule.unlockHour = 10;
      draft.schedule.finaleAt = "2027-01-01T10:00:00+03:00";
    });
    await subscriber("late", new Date("2026-12-20T11:00:00+03:00"));
    // 09:00 — день 2 ещё закрыт, текущий день 1: его окно рассылки (с 10:00 вчера) давно прошло.
    expect(await reminders.run(new Date("2026-12-21T09:00:00+03:00"))).toMatchObject({ skipped: "too_late", day: 1 });
    const result = await reminders.run(new Date("2026-12-21T10:00:00+03:00"));
    expect(result).toMatchObject({ day: 2, sent: 1 });
  });
});

describe("ReminderService.run: окно рассылки", () => {
  it("после окна (maxLateMs от времени рассылки) день не напоминается", async () => {
    const { reminders, subscriber, sent } = setup(undefined, { maxLateMs: 2 * 60 * 60_000 });
    await subscriber("late");
    expect(await reminders.run(at(2, 10, 29))).toMatchObject({ skipped: null, sent: 1 });
    await subscriber("later", at(2, 9));
    expect(await reminders.run(at(2, 10, 30))).toMatchObject({ skipped: "too_late", sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it("новому подписчику, подтвердившему адрес вечером, письмо про утро не шлётся", async () => {
    const { reminders, subscriber, sent } = setup();
    await subscriber("evening", at(2, 20));
    expect(await reminders.run(at(2, 20, 15))).toMatchObject({ skipped: "too_late" });
    expect(sent).toEqual([]);
    // Следующим утром — обычное письмо.
    expect(await reminders.run(at(3, 8, 30))).toMatchObject({ sent: 1, day: 3 });
  });
});

describe("ReminderService.run: идемпотентность и повторы", () => {
  it("повторный запуск того же дня ничего не шлёт; следующий день — шлёт снова", async () => {
    const { reminders, subscriber, sent } = setup();
    await subscriber("once");
    await reminders.run(at(2, 9));
    expect(await reminders.run(at(2, 9, 15))).toMatchObject({ claimed: 0, sent: 0 });
    expect(sent).toHaveLength(1);
    await reminders.run(at(3, 9));
    expect(sent).toHaveLength(2);
    expect(sent[1].vars.dayNumber).toBe(3);
  });

  it("параллельные запуски не дублируют письма", async () => {
    const { reminders, subscriber, sent } = setup();
    for (const name of ["a", "b", "c", "d", "e"]) await subscriber(name);
    const results = await Promise.all([reminders.run(at(2, 9)), reminders.run(at(2, 9)), reminders.run(at(2, 9))]);
    expect(sent).toHaveLength(5);
    expect(new Set(sent.map((item) => item.email)).size).toBe(5);
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(5);
  });

  it("ошибка отправки: failed с кодом без текста ошибки, повтор в следующий запуск, предел попыток", async () => {
    const { reminders, subscriber, sent, repository, failWith } = setup();
    await subscriber("flaky");
    failWith(() => Object.assign(new Error("550 flaky@example.test rejected"), { code: "EENVELOPE" }));

    expect(await reminders.run(at(2, 9, 0))).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    expect(deliveries(repository)[0]).toMatchObject({ status: "failed", attempts: 1, lastError: "smtp_eenvelope" });

    // В тот же запуск (и через 5 минут) повтора нет: пауза между попытками.
    expect(await reminders.run(at(2, 9, 5))).toMatchObject({ claimed: 0 });
    // Через 15 минут (следующий запуск cron) — вторая попытка, снова неудачная.
    expect(await reminders.run(at(2, 9, 15))).toMatchObject({ claimed: 1, failed: 1 });
    // Сервер ожил: третья попытка успешна.
    failWith(null);
    expect(await reminders.run(at(2, 9, 30))).toMatchObject({ claimed: 1, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(await reminders.run(at(2, 9, 45))).toMatchObject({ claimed: 0 });

    const stats = await repository.reminderStats("zerno-advent-2026");
    expect(stats.days).toEqual([{ day: 2, sent: 1, failed: 0, clicked: 0, openedAfter: 0 }]);
  });

  it("после maxAttempts неудач письмо больше не уходит, код ошибки без адреса", async () => {
    const { reminders, subscriber, sent, repository, failWith } = setup(undefined, { maxAttempts: 2 });
    await subscriber("dead");
    failWith(() => Object.assign(new Error("connect ETIMEDOUT dead@example.test"), { code: "ETIMEDOUT" }));
    await reminders.run(at(2, 9, 0));
    await reminders.run(at(2, 9, 15));
    expect(await reminders.run(at(2, 9, 30))).toMatchObject({ claimed: 0 });
    failWith(null);
    expect(await reminders.run(at(2, 9, 45))).toMatchObject({ claimed: 0 });
    expect(sent).toEqual([]);
    const stats = await repository.reminderStats("zerno-advent-2026");
    expect(stats.days[0]).toMatchObject({ sent: 0, failed: 1 });
    // В БД остаётся только код транспорта: ни адреса, ни текста ответа сервера.
    expect(deliveries(repository)).toEqual([expect.objectContaining({ status: "failed", attempts: 2, lastError: "smtp_etimedout" })]);
    expect(JSON.stringify(deliveries(repository))).not.toContain("dead@example.test");
  });

  it("код ошибки состоит из кода транспорта, но не из текста", () => {
    expect(reminderErrorCode(Object.assign(new Error("550 secret@example.test"), { code: "EENVELOPE" }))).toBe("smtp_eenvelope");
    expect(reminderErrorCode(Object.assign(new Error("x"), { code: "a@b.co; drop" }))).toBe("smtp_abcodrop");
    expect(reminderErrorCode(new Error("boom secret@example.test"))).toBe("send_failed");
    expect(reminderErrorCode("строка")).toBe("send_failed");
  });

  it("пачки и потолок за запуск: maxPerRun ограничивает, хвост уходит со следующим запуском", async () => {
    const { reminders, subscriber, sent } = setup(undefined, { batchSize: 2, maxPerRun: 3 });
    for (const name of ["a", "b", "c", "d", "e"]) await subscriber(name);
    expect(await reminders.run(at(2, 9, 0))).toMatchObject({ sent: 3 });
    expect(await reminders.run(at(2, 9, 15))).toMatchObject({ sent: 2 });
    expect(await reminders.run(at(2, 9, 30))).toMatchObject({ sent: 0 });
    expect(new Set(sent.map((item) => item.email)).size).toBe(5);
  });

  it("ограничение скорости: пауза между письмами", async () => {
    const { reminders, subscriber, sleeps } = setup(undefined, { ratePerSecond: 4 });
    await subscriber("a");
    await subscriber("b");
    await reminders.run(at(2, 9));
    expect(sleeps).toEqual([250, 250]);
  });
});

describe("письмо: содержание и варианты", () => {
  it("обычное письмо: бренд, день, teaser, прогресс, ссылки; без наград и кодов", async () => {
    const { reminders, subscriber, sent, advent, service } = setup();
    const person = await subscriber("plain");
    await service.openDay(person.id, 1, at(1, 12));
    await reminders.run(at(2, 9));
    const { vars } = sent[0];

    expect(vars.brandName).toBe(advent.brand.name);
    expect(vars.dayTitle).toBe("Секрет свежести");
    expect(vars.teaser).toBe("Как отличить свежий кофе от залежавшегося");
    expect(vars.buttonLabel).toBe("Открыть дверь 2");
    expect(vars.progress).toEqual({ opened: 1, total: 12 }); // только день 1: подаренный день серии не считается открытым
    expect(vars.comebackText).toBeUndefined();
    expect(vars.catchUpText).toBeUndefined();
    expect(vars.operatorName).toBe(advent.legal.operatorName);
    expect(new URL(vars.link).pathname).toBe("/api/advent/reminders/open");
    expect(vars.unsubscribeUrl).toMatch(/^https:\/\/advent\.test\/unsubscribe\?t=/);
    expect(vars.unsubscribeOneClickUrl).toMatch(/^https:\/\/advent\.test\/api\/advent\/unsubscribe\/one-click\?t=/);

    const blob = JSON.stringify(vars);
    for (const secret of ["Напиток или десерт дня", "Угощение", "Печенье к кофе", "Кофе в подарок", "ZR", "BACK"]) expect(blob).not.toContain(secret);
    expect(blob).not.toContain("plain@example.test");
  });

  it("возвращение: вчера пропущено без заморозки и положен бонус — другая тема, абзац и упоминание догоняния", async () => {
    const { reminders, subscriber, sent, service } = setup();
    const person = await subscriber("back");
    await service.openDay(person.id, 1, at(1, 12));
    await reminders.run(at(4, 9));
    const { vars } = sent[0];

    expect(vars.dayNumber).toBe(4);
    expect(vars.subject).toBe("Мы скучали: дверь 4 ждёт вас");
    expect(vars.preheader).toBe("Вернитесь сегодня — вас ждёт бонус за возвращение");
    expect(vars.comebackText).toContain("бонус за возвращение");
    expect(vars.catchUpText).toBe("А пропущенную дверь 3 ещё можно открыть.");
    expect(JSON.stringify(vars)).not.toContain("Угощение «С возвращением»");
  });

  it("возвращение берёт тексты пакета с подстановками", async () => {
    const { reminders, subscriber, sent, service } = setup((draft) => {
      draft.reminders.comebackSubject = "{day}-й день без вас, а завтра — {teaser}";
      draft.reminders.comebackText = "Вчера вы не заглянули.";
      draft.reminders.catchUpText = "Догоните {missed}-й день.";
    });
    const person = await subscriber("custom");
    await service.openDay(person.id, 1, at(1, 12));
    await reminders.run(at(4, 9));
    expect(sent[0].vars.subject).toBe("4-й день без вас, а завтра — Сегодня решает удача");
    expect(sent[0].vars.comebackText).toBe("Вчера вы не заглянули.");
    expect(sent[0].vars.catchUpText).toBe("Догоните 3-й день.");
  });

  it("пропуск закрыла заморозка — серия жива, обычное письмо, но догоняние упомянуто", async () => {
    const { reminders, subscriber, sent, service } = setup();
    const person = await subscriber("freeze");
    await service.openDay(person.id, 1, at(1, 12));
    await reminders.run(at(3, 9));
    expect(sent[0].vars.subject).toBe("Дверь 3 открыта: Где зёрна живут до заварки");
    expect(sent[0].vars.comebackText).toBeUndefined();
    expect(sent[0].vars.catchUpText).toBe("А пропущенную дверь 2 ещё можно открыть.");
  });

  it("новичок, который ничего не открывал, не «возвращается»; бонус уже получен — тоже обычное письмо", async () => {
    const fresh = setup();
    await fresh.subscriber("fresh", at(3, 9));
    await fresh.reminders.run(at(4, 9));
    expect(fresh.sent[0].vars.comebackText).toBeUndefined();
    expect(fresh.sent[0].vars.subject).toContain("открыта");

    const granted = setup();
    const person = await granted.subscriber("granted");
    await granted.service.openDay(person.id, 1, at(1, 12));
    // Бонус за возвращение выдан при открытии двери на дне 4; на дне 6 снова пропуск, но бонус одноразовый.
    await granted.service.openDay(person.id, 4, at(4, 12));
    await granted.reminders.run(at(6, 9));
    expect(granted.sent[0].vars.comebackText).toBeUndefined();
  });

  it("если догнать нельзя (catchUp none), упоминания нет; без comebackBonusRewardId вариант «возвращение» не включается", async () => {
    const none = setup((draft) => {
      draft.schedule.catchUp = "none";
      delete draft.streak.comebackBonusRewardId;
    });
    const person = await none.subscriber("none");
    await none.service.openDay(person.id, 1, at(1, 12));
    await none.reminders.run(at(4, 9));
    expect(none.sent[0].vars.catchUpText).toBeUndefined();
    expect(none.sent[0].vars.comebackText).toBeUndefined();
  });

  it("тексты пакета не меняют разметку: HTML экранирован", async () => {
    const { renderMail } = await import("@/server/mailer");
    const { reminders, subscriber, sent } = setup((draft) => {
      draft.brand.name = "Зерно <script>alert(1)</script>";
      draft.days[1].title = 'Окно "2" & <b>жирное</b>';
      draft.days[1].teaser = "<img src=x onerror=alert(1)>";
    });
    await subscriber("xss");
    await reminders.run(at(2, 9));
    const mail = renderMail("reminder", sent[0].vars);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).not.toContain("<b>жирное</b>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(mail.text).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("вход из письма, переход и отписка", () => {
  async function delivered() {
    const ctx = setup();
    const person = await ctx.subscriber("click");
    await ctx.reminders.run(at(2, 9));
    const { vars } = ctx.sent[0];
    const link = new URL(vars.link);
    return { ...ctx, person, vars, deliveryId: link.searchParams.get("r")!, token: link.searchParams.get("token")!, unsub: new URL(vars.unsubscribeUrl).searchParams.get("t")! };
  }

  it("ссылка входа доверенная, живёт до конца местных суток и ведёт участника на свой аккаунт без отзыва ключей", async () => {
    const { repository, person, token } = await delivered();
    const current = await repository.getParticipant(person.id);
    const phone = hashToken("phone-key");
    const { participant } = await repository.completeLogin({
      tokenHash: hashToken(token),
      now: at(2, 20),
      campaignSlug: "zerno-advent-2026",
      currentParticipantId: null,
      newAccessKeyHash: phone
    });
    expect(participant.id).toBe(person.id);
    expect((await repository.findParticipantByAccessKeyHash(current!.accessKeyHash))?.id).toBe(person.id);
    // Ссылка одноразовая.
    await expect(
      repository.completeLogin({ tokenHash: hashToken(token), now: at(2, 20, 1), campaignSlug: "zerno-advent-2026", currentParticipantId: null, newAccessKeyHash: "x" })
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("ссылка перестаёт действовать после конца местных суток", async () => {
    const { repository, token } = await delivered();
    await expect(
      repository.completeLogin({ tokenHash: hashToken(token), now: new Date("2026-12-22T00:00:01+03:00"), campaignSlug: "zerno-advent-2026", currentParticipantId: null, newAccessKeyHash: "y" })
    ).rejects.toMatchObject({ code: "expired" });
  });

  it("поздно вечером срок ссылки не короче двух часов", async () => {
    const ctx = setup((draft) => {
      draft.reminders.sendAtLocal = "23:30";
    });
    await ctx.subscriber("night");
    await ctx.reminders.run(at(2, 23, 30));
    const token = new URL(ctx.sent[0].vars.link).searchParams.get("token")!;
    const ok = await ctx.repository.completeLogin({ tokenHash: hashToken(token), now: at(3, 1, 20), campaignSlug: "zerno-advent-2026", currentParticipantId: null, newAccessKeyHash: "z" });
    expect(ok.participant.normalizedEmail).toBe("night@example.test");
  });

  it("ссылка входа не включает подписку заново и не создаёт согласий", async () => {
    const { repository, person, token } = await delivered();
    await repository.setReminderOptIn(person.id, false, at(2, 10));
    await repository.completeLogin({ tokenHash: hashToken(token), now: at(2, 11), campaignSlug: "zerno-advent-2026", currentParticipantId: null, newAccessKeyHash: "k" });
    const after = await repository.getParticipant(person.id);
    expect(after?.reminderOptIn).toBe(false);
    expect(after?.marketingConsentAt).toBeNull();
  });

  it("resolveOpen: на устройстве того же участника засчитывает переход сразу, на чужом — нет", async () => {
    const { reminders, repository, person, deliveryId } = await delivered();
    const stranger = (await newStranger(repository))!;
    expect(await reminders.resolveOpen(deliveryId, stranger, at(2, 10))).toEqual({ day: 2, direct: false });
    expect((await repository.getReminderDelivery(deliveryId))?.clickedAt).toBeNull();
    expect(await reminders.resolveOpen(deliveryId, null, at(2, 10))).toEqual({ day: 2, direct: false });

    const mine = (await repository.getParticipant(person.id))!;
    expect(await reminders.resolveOpen(deliveryId, mine, at(2, 11))).toEqual({ day: 2, direct: true });
    expect((await repository.getReminderDelivery(deliveryId))?.clickedAt).toEqual(at(2, 11));
    // Повторный переход первого не затирает.
    await reminders.resolveOpen(deliveryId, mine, at(2, 15));
    expect((await repository.getReminderDelivery(deliveryId))?.clickedAt).toEqual(at(2, 11));
  });

  it("resolveOpen: мусор, чужая кампания и неизвестная доставка — null", async () => {
    const { reminders } = await delivered();
    for (const id of [null, undefined, "", "not-a-uuid", "00000000-0000-4000-8000-000000000000"]) expect(await reminders.resolveOpen(id, null, at(2, 10))).toBeNull();
  });

  it("confirmLogin засчитывает переход только владельцу доставки", async () => {
    const { reminders, repository, person, deliveryId } = await delivered();
    const stranger = await newStranger(repository);
    expect(await reminders.confirmLogin(deliveryId, stranger!.id, at(2, 10))).toBeNull();
    expect((await repository.getReminderDelivery(deliveryId))?.clickedAt).toBeNull();
    expect(await reminders.confirmLogin(deliveryId, person.id, at(2, 10))).toBe(2);
    expect((await repository.getReminderDelivery(deliveryId))?.clickedAt).toEqual(at(2, 10));
  });

  it("отписка по токену письма: снимает напоминания, не трогает согласие на данные, идемпотентна, работает по токену старого письма", async () => {
    const ctx = await delivered();
    const { reminders, repository, person, unsub } = ctx;
    await reminders.unsubscribe(unsub, at(2, 10));
    const off = await repository.getParticipant(person.id);
    expect(off).toMatchObject({ reminderOptIn: false, unsubscribedAt: at(2, 10) });
    expect(off?.consentAt).not.toBeNull();
    expect(off?.normalizedEmail).toBe("click@example.test");
    await reminders.unsubscribe(unsub, at(2, 20));
    expect((await repository.getParticipant(person.id))?.unsubscribedAt).toEqual(at(2, 10));

    // Включил снова и получил второе письмо; токен первого письма по-прежнему работает.
    await repository.setReminderOptIn(person.id, true, at(3, 1));
    await ctx.reminders.run(at(3, 9));
    const second = new URL(ctx.sent[1].vars.unsubscribeUrl).searchParams.get("t")!;
    expect(second).not.toBe(unsub);
    await reminders.unsubscribe(unsub, at(3, 10));
    expect((await repository.getParticipant(person.id))?.reminderOptIn).toBe(false);
    // После отписки новых писем нет.
    await ctx.reminders.run(at(4, 9));
    expect(ctx.sent).toHaveLength(2);
  });

  it("неизвестный токен отписки — not_found", async () => {
    const { reminders } = await delivered();
    await expect(reminders.unsubscribe("такого-токена-нет-aaaaaaaaaaaaaaaaaaaa", at(2, 10))).rejects.toMatchObject({ code: "not_found" });
  });
});

/** Доставки in-memory репозитория для проверок содержимого (в интерфейсе репозитория листинга нет). */
function deliveries(repository: unknown): Array<{ status: string; attempts: number; lastError: string | null }> {
  return [...(repository as { deliveries: Map<string, { status: string; attempts: number; lastError: string | null }> }).deliveries.values()];
}

async function newStranger(repository: import("@/server/repositories/in-memory-advent-repository").InMemoryAdventRepository) {
  const id = crypto.randomUUID();
  return repository.createParticipant({
    id,
    campaignSlug: "zerno-advent-2026",
    accessKeyHash: hashToken(`k-${id}`),
    normalizedEmail: null,
    teamId: null,
    consentAt: null,
    marketingConsentAt: null,
    reminderOptIn: false,
    unsubscribeHash: null,
    unsubscribedAt: null,
    createdAt: at(1)
  });
}

describe("parseReminderOptions", () => {
  it("значения по умолчанию и разбор окружения", () => {
    expect(parseReminderOptions({})).toEqual(DEFAULT_REMINDER_OPTIONS);
    expect(parseReminderOptions({ REMINDER_BATCH_SIZE: "50", REMINDER_MAX_PER_RUN: "10", REMINDER_MAX_ATTEMPTS: "5", REMINDER_RETRY_MINUTES: "20", REMINDER_RATE_PER_SECOND: "0", REMINDER_MAX_LATE_HOURS: "3" })).toEqual({
      batchSize: 50,
      maxPerRun: 10,
      maxAttempts: 5,
      retryAfterMs: 20 * 60_000,
      ratePerSecond: 0,
      maxLateMs: 3 * 3_600_000
    });
  });

  it("отвергает нечисловые и выходящие за пределы значения", () => {
    expect(() => parseReminderOptions({ REMINDER_BATCH_SIZE: "много" })).toThrow(/REMINDER_BATCH_SIZE/);
    expect(() => parseReminderOptions({ REMINDER_BATCH_SIZE: "0" })).toThrow(/от 1/);
    expect(() => parseReminderOptions({ REMINDER_MAX_ATTEMPTS: "99" })).toThrow(/до 10/);
  });
});

