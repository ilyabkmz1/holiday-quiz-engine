import { describe, expect, it } from "vitest";

import { correctPayload, wrongPayload } from "@/domain/solve";
import { hashToken } from "@/server/crypto";
import { ENDOWED_REWARD_ID } from "@/server/services/advent-service";

import { adventConfig, at, newAdventService, playDay, verifyParticipant } from "../support/advent";

const SECRET_FIELDS = /correctOptionId|correctOptionIds|correctEnabledIds|correctOrder|fakeLetterId|"thanks"|"oops"|"explanation"|"tip"|correctIds/;

describe("AdventService: участник", () => {
  it("создаёт анонимного участника, хранит только хеш ключа и сразу выдаёт подаренный день", async () => {
    const { service, repository } = newAdventService();
    const { participant, accessKey } = await service.createParticipant(at(1, 9));

    expect(participant.accessKeyHash).toBe(hashToken(accessKey));
    expect(participant.accessKeyHash).not.toBe(accessKey);
    expect(participant.normalizedEmail).toBeNull();
    expect((await service.identify(accessKey))?.id).toBe(participant.id);
    expect(await service.identify("чужой-ключ")).toBeNull();
    expect(await service.identify(undefined)).toBeNull();

    const grants = await repository.listGrants(participant.id);
    expect(grants.map((grant) => [grant.source, grant.day, grant.rewardId, grant.code])).toEqual([["endowed", 0, ENDOWED_REWARD_ID, null]]);
    const state = await service.state(participant.id, at(1, 9));
    expect(state.streak).toMatchObject({ endowed: true, progress: 1, current: 0 });
    // Подаренный день — не награда пакета: в публичном списке его нет.
    expect(state.grants).toEqual([]);
  });

  it("без подаренного дня награда endowed не создаётся", async () => {
    const { service, repository } = newAdventService(adventConfig((draft) => { draft.streak.endowedDay = false; }));
    const { participant } = await service.createParticipant(at(1));
    expect(await repository.listGrants(participant.id)).toEqual([]);
    expect((await service.state(participant.id, at(1))).streak.progress).toBe(0);
  });

  it("streak.endowedRewardId: подаренный день выдаёт эту награду, и она видна в состоянии", async () => {
    const { service, repository } = newAdventService(adventConfig((draft) => { draft.streak.endowedRewardId = "daily-gift"; }));
    const { participant } = await service.createParticipant(at(1, 9));
    const grants = await repository.listGrants(participant.id);
    expect(grants.map((grant) => [grant.source, grant.day, grant.rewardId])).toEqual([["endowed", 0, "daily-gift"]]);
    // Анонимному участнику награда с кодом записана без кода и срока: они появятся после входа по ссылке.
    expect(grants[0]).toMatchObject({ code: null, expiresAt: null });
    const state = await service.state(participant.id, at(1, 9));
    expect(state.grants).toMatchObject([{ source: "endowed", day: 0, rewardId: "daily-gift", code: null, needsIdentity: true, qr: null }]);
    // Повторные записи прогресса не дублируют подарок за старт.
    await service.openDay(participant.id, 1, at(1, 10));
    expect((await repository.listGrants(participant.id)).filter((grant) => grant.source === "endowed")).toHaveLength(1);
  });

  it("после конца выдачи (claimEndsAt) новых участников нет", async () => {
    const { service } = newAdventService();
    await expect(service.createParticipant(new Date("2027-01-15T00:00:00+03:00"))).rejects.toMatchObject({ code: "conflict" });
  });

  it("неверный id и участник чужой кампании — not_found", async () => {
    const first = newAdventService();
    const other = newAdventService(adventConfig((draft) => { draft.slug = "other-advent"; }));
    const { participant } = await first.service.createParticipant(at(1));
    await expect(first.service.state("not-a-uuid", at(1))).rejects.toMatchObject({ code: "not_found" });
    // Репозиторий общий: участник первой кампании для сервиса второй не существует.
    const shared = new (await import("@/server/services/advent-service")).AdventService(first.repository, other.advent);
    await expect(shared.state(participant.id, at(1))).rejects.toMatchObject({ code: "not_found" });
    expect(await shared.identify("anything")).toBeNull();
  });
});

describe("AdventService: двери", () => {
  it("до старта все двери закрыты, фаза upcoming, содержимого дней в состоянии нет", async () => {
    const { service } = newAdventService();
    const { participant } = await service.createParticipant(new Date("2026-12-10T12:00:00+03:00"));
    const state = await service.state(participant.id, new Date("2026-12-10T12:00:00+03:00"));
    expect(state.phase).toBe("upcoming");
    expect(state.today).toBeNull();
    expect(state.doors).toHaveLength(12);
    expect(new Set(state.doors.map((door) => door.status))).toEqual(new Set(["locked"]));
    expect(state.days).toEqual([]);
    expect(state.doors[0].unlocksAt).toBe("2026-12-19T21:00:00.000Z");
    await expect(service.openDay(participant.id, 1, new Date("2026-12-10T12:00:00+03:00"))).rejects.toMatchObject({ code: "conflict" });
  });

  it("открывает сегодняшнюю дверь, будущую нельзя, несуществующий день — not_found", async () => {
    const { service } = newAdventService();
    const { participant } = await service.createParticipant(at(3, 8));
    const state = await service.openDay(participant.id, 3, at(3, 8));
    expect(state.doors[2]).toMatchObject({ status: "opened", rewardAvailable: false });
    expect(state.doors[3].status).toBe("locked");
    expect(state.doors[1].status).toBe("catchup");
    expect(state.doors[0].status).toBe("missed");
    expect(state.days.map((day) => day.n)).toEqual([3]);
    await expect(service.openDay(participant.id, 4, at(3, 8))).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("не наступил") });
    await expect(service.openDay(participant.id, 1, at(3, 8))).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("нельзя открыть") });
    await expect(service.openDay(participant.id, 13, at(3, 8))).rejects.toMatchObject({ code: "not_found" });
    await expect(service.openDay(participant.id, 0, at(3, 8))).rejects.toMatchObject({ code: "not_found" });
  });

  it("catchUp none: прошедший день открыть нельзя; all: можно любой прошедший, пока идёт адвент", async () => {
    const none = newAdventService(adventConfig((draft) => { draft.schedule.catchUp = "none"; }));
    const a = await none.service.createParticipant(at(1));
    await expect(none.service.openDay(a.participant.id, 1, at(2))).rejects.toMatchObject({ code: "conflict" });

    const all = newAdventService(adventConfig((draft) => { draft.schedule.catchUp = "all"; }));
    const b = await all.service.createParticipant(at(1));
    const state = await all.service.openDay(b.participant.id, 1, at(10));
    expect(state.doors[0]).toMatchObject({ status: "opened" });
    // После финала новые двери не открываются даже при catchUp all.
    await expect(all.service.openDay(b.participant.id, 2, new Date("2027-01-02T12:00:00+03:00"))).rejects.toMatchObject({ code: "conflict" });
  });

  it("повторное открытие идемпотентно: время и onTime первого открытия сохраняются", async () => {
    const { service, repository } = newAdventService();
    const { participant } = await service.createParticipant(at(2, 9));
    await service.openDay(participant.id, 2, at(2, 9));
    await service.openDay(participant.id, 2, at(2, 18));
    await service.openDay(participant.id, 2, at(3, 1)); // уже следующий день, но день 2 открыт
    const opens = await repository.listDayOpens(participant.id);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ day: 2, onTime: true, openedAt: at(2, 9) });
  });

  it("догнанный день пишется с onTime = false", async () => {
    const { service, repository } = newAdventService();
    const { participant } = await service.createParticipant(at(1));
    await service.openDay(participant.id, 2, at(3, 9));
    expect((await repository.listDayOpens(participant.id))[0]).toMatchObject({ day: 2, onTime: false });
  });
});

describe("AdventService: блоки и задания", () => {
  it("состояние не раскрывает ответы до фиксации; разбор приходит в ответе и затем в состоянии", async () => {
    const { service, advent } = newAdventService();
    const { participant } = await service.createParticipant(at(1));
    const before = await service.openDay(participant.id, 1, at(1));
    expect(JSON.stringify(before)).not.toMatch(SECRET_FIELDS);
    // Содержимое остальных дней и правильные варианты не в состоянии.
    expect(before.days).toHaveLength(1);

    const taskIndex = advent.days[0].blocks.findIndex((block) => block.type === "task");
    const task = advent.days[0].blocks[taskIndex];
    if (task.type !== "task") throw new Error("в дне 1 должно быть задание");
    const submitted = await service.submitBlock(participant.id, 1, taskIndex, correctPayload(task.task), at(1));
    expect(submitted.block.outcome).toMatchObject({ base: 100, outcome: "perfect", mood: "happy" });
    expect(submitted.block.outcome!.correctIds.length).toBeGreaterThan(0);
    expect(submitted.block.outcome!.explanation).toBe(task.task.explanation);

    const after = await service.state(participant.id, at(1));
    const block = after.days[0].blocks[taskIndex];
    expect(block).toMatchObject({ type: "task", done: true });
    // Разбор остаётся доступным после перезагрузки, а ответы остальных блоков — нет.
    expect(block.type === "task" && block.outcome?.correctIds).toEqual(submitted.block.outcome!.correctIds);
  });

  it("баллы задания считаются сервером: верно 100, частично 50, неверно 0", async () => {
    const { service, advent, repository } = newAdventService();
    const { participant } = await service.createParticipant(at(2));
    await service.openDay(participant.id, 2, at(2));
    const index = advent.days[1].blocks.findIndex((block) => block.type === "task");
    const block = advent.days[1].blocks[index];
    if (block.type !== "task") throw new Error("задание");
    const result = await service.submitBlock(participant.id, 2, index, wrongPayload(block.task), at(2));
    expect(result.block.outcome).toMatchObject({ base: 0, outcome: "miss", mood: "sad" });
    expect((await repository.listBlockResults(participant.id))[0].points).toBe(0);
  });

  it("повторный ответ (в том числе другой) возвращает сохранённый результат и ничего не дублирует", async () => {
    const { service, advent, repository } = newAdventService();
    const { participant } = await service.createParticipant(at(1));
    await service.openDay(participant.id, 1, at(1));
    const index = advent.days[0].blocks.findIndex((block) => block.type === "task");
    const block = advent.days[0].blocks[index];
    if (block.type !== "task") throw new Error("задание");

    const first = await service.submitBlock(participant.id, 1, index, correctPayload(block.task), at(1));
    const second = await service.submitBlock(participant.id, 1, index, wrongPayload(block.task), at(1, 20));
    const third = await service.submitBlock(participant.id, 1, index, { мусор: true }, at(1, 21));
    expect(second.block.outcome).toEqual(first.block.outcome);
    expect(third.block.outcome).toEqual(first.block.outcome);
    expect(await repository.listBlockResults(participant.id)).toHaveLength(1);
  });

  it("неверная форма ответа — invalid, результат не записывается и повторить можно", async () => {
    const { service, advent, repository } = newAdventService();
    const { participant } = await service.createParticipant(at(1));
    await service.openDay(participant.id, 1, at(1));
    const index = advent.days[0].blocks.findIndex((block) => block.type === "task");
    const block = advent.days[0].blocks[index];
    if (block.type !== "task") throw new Error("задание");
    await expect(service.submitBlock(participant.id, 1, index, { optionId: "нет-такого" }, at(1))).rejects.toMatchObject({ code: "invalid" });
    expect(await repository.listBlockResults(participant.id)).toEqual([]);
    await service.submitBlock(participant.id, 1, index, correctPayload(block.task), at(1));
  });

  it("блок нельзя отправить в неоткрытом дне, несуществующий блок — not_found", async () => {
    const { service } = newAdventService();
    const { participant } = await service.createParticipant(at(1));
    await expect(service.submitBlock(participant.id, 1, 0, {}, at(1))).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("откройте") });
    await service.openDay(participant.id, 1, at(1));
    await expect(service.submitBlock(participant.id, 1, 9, {}, at(1))).rejects.toMatchObject({ code: "not_found" });
    await expect(service.submitBlock(participant.id, 99, 0, {}, at(1))).rejects.toMatchObject({ code: "not_found" });
    await expect(service.submitBlock(participant.id, 1, -1, {}, at(1))).rejects.toMatchObject({ code: "not_found" });
  });

  it("блоки удачи и подарка не раскрывают исход в состоянии, пока не выполнены", async () => {
    const { service, advent } = newAdventService();
    const { participant } = await service.createParticipant(at(4));
    const state = await service.openDay(participant.id, 4, at(4));
    const luckIndex = advent.days[3].blocks.findIndex((block) => block.type === "luck");
    expect(state.days[0].blocks[luckIndex]).toEqual({ index: luckIndex, type: "luck", choices: 3, done: false, ready: false, needsIdentity: true, reveal: null });
    expect(JSON.stringify(state)).not.toMatch(/luck-a|luck-b|weight/);
  });

});

describe("AdventService: награды", () => {
  it("награда дня выдаётся, когда день пройден, и только один раз; анонимному — без кода, после входа — с кодом", async () => {
    const { service, advent, repository } = newAdventService();
    const { participant } = await service.createParticipant(at(2));
    await service.openDay(participant.id, 2, at(2));
    expect((await repository.listGrants(participant.id)).filter((grant) => grant.source === "day")).toEqual([]);

    await playDay(service, advent, participant.id, 2, at(2, 14));
    await playDay(service, advent, participant.id, 2, at(2, 15));
    const dayGrants = (await repository.listGrants(participant.id)).filter((grant) => grant.source === "day");
    expect(dayGrants).toHaveLength(1);
    expect(dayGrants[0]).toMatchObject({ day: 2, rewardId: "daily-gift", code: null, expiresAt: null, status: "issued" });
    const anonymous = await service.state(participant.id, at(2, 15));
    expect(anonymous.grants.find((grant) => grant.source === "day")).toMatchObject({ label: "Напиток или десерт дня", code: null, needsIdentity: true, qr: null });

    // Вход по ссылке дозаполняет код и срок (от момента входа); повторные записи его не меняют.
    await verifyParticipant({ service, repository, advent }, participant.id, at(2, 16));
    const [verified] = (await repository.listGrants(participant.id)).filter((grant) => grant.source === "day");
    expect(verified.code).toMatch(/^ZR[0-9A-Z]{6}$/);
    expect(verified.expiresAt).toEqual(new Date(at(2, 16).getTime() + 2 * 24 * 60 * 60 * 1000));
    await playDay(service, advent, participant.id, 2, at(2, 17));
    expect((await repository.listGrants(participant.id)).find((grant) => grant.source === "day")!.code).toBe(verified.code);
    const state = await service.state(participant.id, at(2, 18));
    expect(state.grants.find((grant) => grant.source === "day")).toMatchObject({ code: verified.code, needsIdentity: false, codePending: false, redeem: "cashier" });
  });

  it("день без награды дня (rewardId не задан) награды не выдаёт, сколько ни проходи", async () => {
    const { service, repository, advent } = newAdventService();
    const { participant } = await service.createParticipant(at(4));
    await service.openDay(participant.id, 4, at(4));
    await playDay(service, advent, participant.id, 4, at(4));
    expect((await repository.listGrants(participant.id)).filter((grant) => grant.source === "day")).toEqual([]);
  });

  it("rewardOnlyOnDay: за догнанный день награды дня нет, без этого флага — есть", async () => {
    const strict = newAdventService();
    const a = await strict.service.createParticipant(at(1));
    await strict.service.openDay(a.participant.id, 2, at(3)); // догоняем день 2 на третий день
    await playDay(strict.service, strict.advent, a.participant.id, 2, at(3));
    expect((await strict.repository.listGrants(a.participant.id)).filter((grant) => grant.source === "day")).toEqual([]);
    expect((await strict.service.state(a.participant.id, at(3))).doors[1]).toMatchObject({ status: "opened", completed: true });

    const relaxed = newAdventService(adventConfig((draft) => { draft.schedule.rewardOnlyOnDay = false; }));
    const b = await relaxed.service.createParticipant(at(1));
    await relaxed.service.openDay(b.participant.id, 2, at(3));
    await playDay(relaxed.service, relaxed.advent, b.participant.id, 2, at(3));
    expect((await relaxed.repository.listGrants(b.participant.id)).filter((grant) => grant.source === "day")).toHaveLength(1);
  });

  it("цели серии выдаются один раз, когда прогресс (с подаренным днём) дошёл до порога", async () => {
    const { service, repository, advent } = newAdventService();
    const { participant } = await service.createParticipant(at(1));
    const goals = async () => (await repository.listGrants(participant.id)).filter((grant) => grant.source === "goal").map((grant) => [grant.day, grant.rewardId]);

    for (const n of [1, 2]) await service.openDay(participant.id, n, at(n));
    expect(await goals()).toEqual([]); // прогресс 3 из 4
    await service.openDay(participant.id, 3, at(3));
    expect(await goals()).toEqual([[4, "goal-gift"]]); // 3 двери + подаренный день = 4
    await playDay(service, advent, participant.id, 3, at(3));
    await service.openDay(participant.id, 3, at(3, 20));
    expect(await goals()).toEqual([[4, "goal-gift"]]);

    const state = await service.state(participant.id, at(3));
    expect(state.goals).toEqual([
      { opened: 4, rewardId: "goal-gift", label: "Десерт за серию", reached: true, granted: true },
      { opened: 8, rewardId: "final-entry", label: "Участие в финальном розыгрыше", reached: false, granted: false }
    ]);
    expect(state.nextGoal).toEqual({ opened: 8, rewardId: "final-entry", label: "Участие в финальном розыгрыше" });
  });

  it("бонус за возвращение: один раз за кампанию и только после реального обрыва серии", async () => {
    const { service, repository } = newAdventService();
    const { participant } = await service.createParticipant(at(1));
    const comebacks = async () => (await repository.listGrants(participant.id)).filter((grant) => grant.source === "comeback");

    await service.openDay(participant.id, 1, at(1));
    expect(await comebacks()).toEqual([]);

    // День 2 пропущен: его закрывает единственная заморозка, серия жива, бонуса нет.
    await service.openDay(participant.id, 3, at(3));
    expect(await comebacks()).toEqual([]);
    expect((await service.state(participant.id, at(3))).streak).toMatchObject({ comebackEligible: false, freezesLeft: 0 });

    // День 4 пропущен без заморозок: серия оборвана, возвращение на день 5 даёт бонус.
    const before = await service.state(participant.id, at(5, 9));
    expect(before.streak).toMatchObject({ current: 0, comebackEligible: true, comebackGranted: false });
    const after = await service.openDay(participant.id, 5, at(5, 9));
    expect(await comebacks()).toHaveLength(1);
    expect((await comebacks())[0]).toMatchObject({ day: 0, rewardId: "comeback-gift", code: null });
    expect(after.streak).toMatchObject({ comebackEligible: false, comebackGranted: true });
    expect(after.grants.some((grant) => grant.source === "comeback")).toBe(true);

    // Второй обрыв бонуса не даёт: он один на кампанию.
    await service.openDay(participant.id, 6, at(6));
    await service.openDay(participant.id, 9, at(9)); // дни 7–8 пропущены
    expect((await service.state(participant.id, at(9))).streak.current).toBe(1);
    expect(await comebacks()).toHaveLength(1);
    await service.openDay(participant.id, 9, at(9, 20));
    expect(await comebacks()).toHaveLength(1);
  });

  it("новичок, впервые пришедший позже, не «возвращается»", async () => {
    const { service, repository } = newAdventService();
    const { participant } = await service.createParticipant(at(6));
    const state = await service.openDay(participant.id, 6, at(6));
    expect(state.streak.comebackEligible).toBe(false);
    expect((await repository.listGrants(participant.id)).filter((grant) => grant.source === "comeback")).toEqual([]);
  });

  it("повторное открытие двери после обрыва догоняет пропущенную выдачу бонуса (сбой между записью и наградой)", async () => {
    const { service, repository } = newAdventService();
    const { participant } = await service.createParticipant(at(1));
    await service.openDay(participant.id, 1, at(1));
    // Имитация сбоя: дверь дня 5 записана, а награды ещё нет.
    await repository.openDayOnce(participant.id, 5, at(5), true);
    expect((await repository.listGrants(participant.id)).some((grant) => grant.source === "comeback")).toBe(false);
    await service.openDay(participant.id, 5, at(5, 10));
    expect((await repository.listGrants(participant.id)).filter((grant) => grant.source === "comeback")).toHaveLength(1);
  });

  it("без comebackBonusRewardId бонус не выдаётся", async () => {
    const { service, repository } = newAdventService(adventConfig((draft) => { delete draft.streak.comebackBonusRewardId; }));
    const { participant } = await service.createParticipant(at(1));
    await service.openDay(participant.id, 1, at(1));
    await service.openDay(participant.id, 5, at(5));
    expect((await repository.listGrants(participant.id)).some((grant) => grant.source === "comeback")).toBe(false);
  });

  it("после claimEndsAt награды не выдаются", async () => {
    const { service, repository, advent } = newAdventService();
    const { participant } = await service.createParticipant(at(12));
    await service.openDay(participant.id, 12, at(12));
    const closed = new Date("2027-01-20T12:00:00+03:00");
    await expect(service.submitBlock(participant.id, 12, 0, {}, closed)).rejects.toMatchObject({ code: "conflict" });
    expect((await repository.listGrants(participant.id)).filter((grant) => grant.source === "day")).toEqual([]);
    expect(advent.days[11].rewardId).toBeUndefined();
  });
});

describe("AdventService: полный путь на 12 дней", () => {
  it("идеальный игрок: каждый день вовремя, серия 12, награды дня на 9 днях, цели и подаренный день, без дублей", async () => {
    const ctx = newAdventService();
    const { service, repository, advent } = ctx;
    const { participant: anonymous } = await service.createParticipant(at(1, 8));
    // Награды с кодами и удача выдаются только после входа по ссылке.
    const participant = await verifyParticipant(ctx, anonymous.id, at(1, 8, 30));

    for (let n = 1; n <= 12; n += 1) {
      const state = await service.openDay(participant.id, n, at(n, 9));
      expect(state.today).toBe(n);
      expect(state.doors[n - 1].status).toBe("opened");
      await playDay(service, advent, participant.id, n, at(n, 10));
      // Повтор того же дня ничего не меняет.
      await service.openDay(participant.id, n, at(n, 22));
      await playDay(service, advent, participant.id, n, at(n, 23));
    }

    const finale = new Date("2027-01-01T12:00:00+03:00");
    const state = await service.state(participant.id, finale);
    expect(state.phase).toBe("finale");
    expect(state.streak).toMatchObject({ current: 12, best: 12, progress: 13, comebackGranted: false });
    expect(state.doors.every((door) => door.status === "opened" && door.completed)).toBe(true);
    expect(state.goals.every((goal) => goal.reached && goal.granted)).toBe(true);
    expect(state.nextGoal).toBeNull();

    const grants = await repository.listGrants(participant.id);
    const by = (source: string) => grants.filter((grant) => grant.source === source);
    expect(by("endowed")).toHaveLength(1);
    expect(by("goal").map((grant) => grant.day).sort((a, b) => a - b)).toEqual([4, 8]);
    expect(by("day").map((grant) => grant.day)).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11].sort((a, b) => a - b));
    expect(by("comeback")).toEqual([]);
    expect(by("luck").map((grant) => grant.day)).toEqual([4, 8, 12]);
    expect(grants).toHaveLength(1 + 2 + 9 + 3);
    // Код есть у каждой награды с кодами; подарок за старт (псевдо-награда) и «участие в розыгрыше» кодов не имеют.
    for (const grant of grants) {
      const reward = advent.rewards.find((candidate) => candidate.id === grant.rewardId);
      expect(grant.code !== null, `${grant.source}:${grant.day}`).toBe(Boolean(reward?.codes));
    }
    expect(new Set(grants.filter((grant) => grant.code).map((grant) => grant.code)).size).toBe(grants.filter((grant) => grant.code).length);
  });

  it("игрок с пропусками и догонянием: серия рвётся, прогресс растёт, догнанный день не идёт в серию", async () => {
    const { service, repository, advent } = newAdventService();
    const { participant } = await service.createParticipant(at(1));
    await service.openDay(participant.id, 1, at(1));
    await playDay(service, advent, participant.id, 1, at(1));
    // День 2 пропущен (его закрывает заморозка), день 3 вовремя, день 4 пропущен и догоняется на 5-й день (окно 1).
    await service.openDay(participant.id, 3, at(3));
    const caught = await service.openDay(participant.id, 4, at(5, 8));

    expect(caught.doors.slice(0, 5).map((door) => door.status)).toEqual(["opened", "missed", "opened", "opened", "today"]);
    expect(caught.streak).toMatchObject({ current: 0, best: 2, progress: 4, freezesLeft: 0 });
    expect(await repository.listDayOpens(participant.id)).toMatchObject([
      { day: 1, onTime: true },
      { day: 3, onTime: true },
      { day: 4, onTime: false }
    ]);
    // Прогресс 4 (три двери и подаренный день) достиг первой цели; возвращение после обрыва дало бонус.
    const grants = await repository.listGrants(participant.id);
    // Анонимный игрок не проходит день 1 до конца (подарок дня требует входа), поэтому награды дня 1 нет.
    expect(grants.map((grant) => `${grant.source}:${grant.day}`).sort()).toEqual(["comeback:0", "endowed:0", "goal:4"]);
    // День 2 вне окна: открыть его позже нельзя.
    await expect(service.openDay(participant.id, 2, at(5, 9))).rejects.toMatchObject({ code: "conflict" });
  });
});
