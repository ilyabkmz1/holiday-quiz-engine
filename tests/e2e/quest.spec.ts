import { createSessionViaApi, getState, playAllRoomsViaApi, playRoomViaApi, startRushViaApi } from "./support/api";
import { claimForm, expectClaimSent, exportedRowsFor, submitClaim, uniqueEmail } from "./support/claim";
import { campaign, copy, isQuestTenant, pack, prologueHero } from "./support/tenant";
import { buildWorldModel } from "../../src/worlds/model";
import { loadWorld } from "../../src/worlds/registry";
import { expect, test } from "./support/fixtures";
import { escapeRegExp, expectReveal, fillTask, outcomeFor, roomAt, rooms, type Press } from "./support/game";
import { expectVisibleFocus, focusByTab } from "./support/keyboard";
import { verificationLinkFor } from "./support/mailpit";
import {
  answerQuestRush, completeQuest, questRushPrompt, QUEST_URL, expectPhase, finalResult, openRoomViaList, playQuestRoom, questRoomOrder, reachQuestFinalViaApi, roomListButton, sheet, startQuest
} from "./support/quest";

// Граф мира арендатора: квест-сценарии ходят по точкам его мира, а не по константам снежного шара.
const { GRAPH } = buildWorldModel(loadWorld(pack.worldId), campaign.rooms);

// Квест — основной режим только у кампаний `mode: "quest"`; на карточных (demo-coffee) главная показывает карточки.
test.describe("квест", () => {
  test.skip(!isQuestTenant, "кампания в режиме cards: квест-сценарии не применимы");

  test("полный путь: пролог → все комнаты в нестандартном порядке → рывок у ёлки → финал → заявка → письмо → подтверждение", async ({ page, request }) => {
    test.setTimeout(240_000);
    await startQuest(page);
    await expect(page.getByTestId("goal")).toContainText("Цель:");
    // Пока ни одна комната не светится, рывка нет.
    await expect(page.locator('.qw-room[data-lit="true"]')).toHaveCount(0);

    await completeQuestFromRooms(page);
    const { session } = await getState(page, (await page.evaluate(() => window.localStorage.getItem("hqe-holiday-quiz-session")))!);
    expect(session.status).toBe("completed");
    const final = session.final!;
    const result = finalResult(page);
    await expect(result.getByRole("heading", { level: 2, name: final.level.title })).toBeVisible();
    await expect(result.getByLabel(`${final.score} очков`)).toBeVisible();
    await expect(page.locator('.qw-room[data-lit="true"]')).toHaveCount(rooms.length);
    await expect(page.getByLabel(copy.ornamentsAria).getByRole("img")).toHaveCount(rooms.length);

    await page.getByRole("button", { name: "Забрать подарок" }).click();
    await expectPhase(page, "claim");
    await expect(page.getByText("Подарок — один на email")).toBeVisible();
    const email = uniqueEmail("quest");
    const response = await submitClaim(page, { email });
    expect(await response.json()).toMatchObject({ status: "claim_pending", created: true });
    await expectClaimSent(page);
    expect(await exportedRowsFor(request, email)).toHaveLength(0);

    const link = await verificationLinkFor(request, email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/verify\?status=success$/);
    await expect(page.getByRole("heading", { level: 1, name: "Результат подтверждён" })).toBeVisible();
    const rows = await exportedRowsFor(request, email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(`"${final.score}"`);
  });

  test("облачко героя до входа в комнату показывает настоящую реплику, а ответов нет ни в разметке, ни в ответе API", async ({ page }) => {
    await startQuest(page);
    const id = (await page.evaluate(() => window.localStorage.getItem("hqe-holiday-quiz-session")))!;
    const body = JSON.stringify(await getState(page, id));
    for (const room of rooms) {
      for (const secret of [room.tasks[0].thanks, room.tasks[0].oops, room.tasks[0].tip, room.tasks[0].explanation]) expect(body).not.toContain(secret);
    }
    const mail = roomAt(0);
    await roomListButton(page).click();
    await page.getByRole("dialog", { name: "Список комнат" }).getByRole("button", { name: new RegExp(escapeRegExp(roomAt(0).title)) }).click();
    await expect(page.locator(".qw-bubble").filter({ hasText: mail.tasks[0].say })).toBeVisible();
  });

  test("перезагрузка на разборе возвращает тот же разбор, на итоге комнаты — итог", async ({ page }) => {
    test.setTimeout(120_000);
    await startQuest(page);
    const room = roomAt(1);
    await openRoomViaList(page, room);
    await fillTask(page, room.tasks[0], "correct");
    await expectReveal(page, "perfect");
    await page.reload();
    await expectPhase(page, "room");
    await expectReveal(page, "perfect");
    await page.getByRole("button", { name: "Следующая заявка" }).click();
    await fillTask(page, room.tasks[1], "correct");
    await page.getByRole("button", { name: "Следующая заявка" }).click();
    await fillTask(page, room.tasks[2], "correct");
    await page.getByRole("button", { name: "Включить свет в комнате" }).click();
    await expect(page.getByRole("heading", { level: 2, name: `${room.title}: свет включён` })).toBeVisible();
    await page.reload();
    await expectPhase(page, "room");
    await expect(page.getByRole("heading", { level: 2, name: `${room.title}: свет включён` })).toBeVisible();
    await page.getByRole("button", { name: copy.hangOrnament }).click();
    await expectPhase(page, "explore", 30_000);
  });

  test("перезагрузка посреди комнаты и во время рывка возвращает игрока на место", async ({ page }) => {
    test.setTimeout(120_000);
    const id = await createSessionViaApi(page, QUEST_URL);
    await playRoomViaApi(page, id, roomAt(0).id, ["correct", "correct", "correct"], 3);
    await playRoomViaApi(page, id, roomAt(3).id, ["correct"], 1);
    await page.reload();
    await expectPhase(page, "room");
    await expect(sheet(page, roomAt(3))).toBeVisible();
    await expect(page.locator(`.qw-room[data-room="${roomAt(0).id}"]`)).toHaveAttribute("data-lit", "true");
  });

  test("проход только с клавиатуры через «Список комнат»", async ({ page }) => {
    test.setTimeout(120_000);
    await startQuest(page);
    const keyboardPress: Press = async (target) => {
      await focusByTab(page, target);
      await expectVisibleFocus(page);
      await page.keyboard.press((await target.getAttribute("role")) === "switch" ? "Space" : "Enter");
    };
    const room = roomAt(2);
    await keyboardPress(roomListButton(page));
    // Список забирает фокус на первую комнату; Escape возвращает его на кнопку.
    await expect(page.locator(".qw-list-item").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(roomListButton(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await keyboardPress(page.getByRole("dialog", { name: "Список комнат" }).getByRole("button", { name: new RegExp(escapeRegExp(room.title)) }));
    const help = page.getByRole("button", { name: /^Помочь:/ });
    await expect(help).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sheet(page, room)).toBeVisible();
    // Мир за карточкой недоступен (inert), фокус внутри диалога; Escape закрывает карточку и возвращает фокус в мир.
    for (const [index, task] of room.tasks.entries()) {
      await fillTask(page, task, "correct", keyboardPress);
      await expectReveal(page, outcomeFor(task, "correct"));
      const last = index === room.tasks.length - 1;
      await keyboardPress(page.getByRole("button", { name: last ? "Включить свет в комнате" : "Следующая заявка" }));
    }
    await keyboardPress(page.getByRole("button", { name: copy.hangOrnament }));
    await expectPhase(page, "explore", 30_000);
  });

  test("весь квест только с клавиатуры, без программного focus(): все комнаты через «Список комнат», рывок цифрами, финал, заявка", async ({ page, request }) => {
    test.setTimeout(240_000);
    await startQuestWithKeyboard(page);
    const press: Press = async (target) => {
      await focusByTab(page, target);
      await expectVisibleFocus(page);
      await page.keyboard.press((await target.getAttribute("role")) === "switch" ? "Space" : "Enter");
    };
    for (const [index, room] of questRoomOrder.entries()) {
      await press(roomListButton(page));
      await press(page.getByRole("dialog", { name: "Список комнат" }).getByRole("button", { name: new RegExp(escapeRegExp(room.title)) }));
      // После выбора комнаты фокус сам попадает на «Помочь».
      await expect(page.getByRole("button", { name: /^Помочь:/ })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(sheet(page, room)).toBeVisible();
      for (const [taskIndex, task] of room.tasks.entries()) {
        await fillTask(page, task, "correct", press);
        await expectReveal(page, outcomeFor(task, "correct"));
        await press(page.getByRole("button", { name: taskIndex === room.tasks.length - 1 ? "Включить свет в комнате" : "Следующая заявка" }));
      }
      await press(page.getByRole("button", { name: copy.hangOrnament }));
      await expectPhase(page, index === questRoomOrder.length - 1 ? "rushIntro" : "explore", 30_000);
    }
    await press(page.getByRole("button", { name: "Поехали!" }));
    await expectPhase(page, "rush");
    for (let step = 0; step < campaign.rush.pool.length; step += 1) {
      const prompt = await questRushPrompt(page);
      const item = campaign.rush.pool.find((candidate) => candidate.prompt === prompt)!;
      await page.keyboard.press(String(campaign.rush.services.findIndex((service) => service.id === item.serviceId) + 1));
      if (step < campaign.rush.pool.length - 1) await expect(page.locator('.qw-bubble[data-bubble="rush-prompt"]')).not.toContainText(prompt);
    }
    await expectPhase(page, "final", 40_000);
    await press(page.getByRole("button", { name: "Забрать подарок" }));
    await expectPhase(page, "claim");
    const form = claimForm(page);
    const email = uniqueEmail("kbd");
    await focusByTab(page, form.name);
    await page.keyboard.type("Анна Тестова");
    await focusByTab(page, form.company);
    await page.keyboard.type("ООО «Тест»");
    await focusByTab(page, form.email);
    await page.keyboard.type(email);
    await focusByTab(page, form.consent);
    await page.keyboard.press("Space");
    await expect(form.consent).toBeChecked();
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => candidate.request().method() === "POST" && /\/claim$/.test(new URL(candidate.url()).pathname)),
      (async () => {
        await focusByTab(page, form.submit);
        await page.keyboard.press("Enter");
      })()
    ]);
    expect(await response.json()).toMatchObject({ status: "claim_pending", created: true });
    await expectClaimSent(page);
    expect(await exportedRowsFor(request, email)).toHaveLength(0);
  });

  test("перезагрузка во время рывка возвращает в рывок на той же заявке, а не в начало", async ({ page }) => {
    test.setTimeout(120_000);
    const id = await createSessionViaApi(page, QUEST_URL);
    await playAllRoomsViaApi(page, id);
    await startRushViaApi(page, id);
    await page.reload();
    await expectPhase(page, "rush");
    await expect(page.getByRole("group", { name: "Сервисы" })).toBeVisible();
    const first = await answerQuestRush(page, true);
    await expect(page.locator('.qw-bubble[data-bubble="rush-prompt"]')).not.toContainText(first);
    const second = await answerQuestRush(page, true);
    await expect(page.locator('.qw-bubble[data-bubble="rush-prompt"]')).not.toContainText(second);
    const third = await questRushPrompt(page);
    await page.reload();
    await expectPhase(page, "rush");
    expect(await questRushPrompt(page)).toBe(third);
    await expect(page.getByRole("timer")).toBeVisible();
    // Игру можно довести до финала после перезагрузки.
    for (let index = 2; index < campaign.rush.pool.length; index += 1) {
      const prompt = await answerQuestRush(page, true);
      if (index < campaign.rush.pool.length - 1) await expect(page.locator('.qw-bubble[data-bubble="rush-prompt"]')).not.toContainText(prompt);
    }
    await expectPhase(page, "final", 40_000);
  });

  test("после × на разборе последней заявки и праздника перезагрузка ведёт в мир, а не в разбор пройденной комнаты", async ({ page }) => {
    test.setTimeout(120_000);
    await startQuest(page);
    const room = roomAt(3);
    await openRoomViaList(page, room);
    for (const [index, task] of room.tasks.entries()) {
      await fillTask(page, task, "correct");
      await expectReveal(page, outcomeFor(task, "correct"));
      if (index < room.tasks.length - 1) await page.getByRole("button", { name: "Следующая заявка" }).click();
    }
    await page.getByRole("button", { name: "Отойти от героя: закрыть заявку" }).click();
    await expectPhase(page, "explore", 30_000);
    await page.reload();
    await expectPhase(page, "explore");
    await expect(page.locator(`.qw-room[data-room="${roomAt(3).id}"]`)).toHaveAttribute("data-lit", "true");
    await expect(page.getByRole("dialog", { name: /Заявка в комнате/ })).toHaveCount(0);
  });

  test("после × героя имя на кнопке «Помочь», облачко и цель совпадают с героем следующей заявки", async ({ page }) => {
    await startQuest(page);
    const room = roomAt(0);
    await openRoomViaList(page, room);
    await fillTask(page, room.tasks[0], "correct");
    await expectReveal(page, outcomeFor(room.tasks[0], "correct"));
    await page.getByRole("button", { name: "Отойти от героя: закрыть заявку" }).click();
    await expectPhase(page, "explore");
    await roomListButton(page).click();
    await page.getByRole("dialog", { name: "Список комнат" }).getByRole("button", { name: new RegExp(escapeRegExp(room.title)) }).click();
    const help = page.getByRole("button", { name: /^Помочь:/ });
    await expect(help).toBeVisible();
    const hero = campaign.heroes.find((candidate) => candidate.id === room.tasks[1].heroId)!;
    await expect(help).toHaveText(`Помочь: ${hero.name}`);
    await expect(page.getByTestId("goal")).toContainText(`${room.title} — ${hero.name}`);
    const bubble = page.locator(".qw-bubble").filter({ hasText: room.tasks[1].say });
    await expect(bubble).toBeVisible();
    await expect(bubble.locator("b")).toHaveText(hero.name);
  });

  test("Escape закрывает карточку заявки без потери прогресса", async ({ page }) => {
    await startQuest(page);
    const room = roomAt(0);
    await openRoomViaList(page, room);
    await page.keyboard.press("Escape");
    await expectPhase(page, "explore");
    await expect(page.locator(".qw-help, .qw-list-btn").first()).toBeVisible();
    await openRoomViaList(page, room);
    await expect(page.locator(".qw-hud").getByText(`${room.title} · заявка 1 из 3`)).toBeVisible();
  });

  test("на экране нет горизонтального скролла, тач-цели не меньше 44 px", async ({ page }) => {
    test.setTimeout(120_000);
    await startQuest(page);
    const check = async (label: string) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `горизонтальный скролл: ${label}`).toBeLessThanOrEqual(0);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("button, [role='switch']")]
          .filter((el) => el.offsetParent !== null && !el.closest("[inert]"))
          .map((el) => ({ name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30), w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }))
          .filter((item) => item.w < 43.5 || item.h < 43.5)
      );
      expect(small, `тач-цели < 44 px: ${label}`).toEqual([]);
    };
    await check("мир");
    await roomListButton(page).click();
    await check("список комнат");
    await page.keyboard.press("Escape");
    await openRoomViaList(page, roomAt(0));
    await check("карточка заявки");
  });

  test("после завершения квест восстанавливается на итоге; «Сыграть ещё раз» ведёт в пролог", async ({ page }) => {
    test.setTimeout(120_000);
    await reachQuestFinalViaApi(page);
    await page.getByRole("button", { name: "Сыграть ещё раз" }).click();
    await expectPhase(page, "prologue");
  });

  test("после игры в одной вкладке «Сыграть ещё раз» заново запускает пролог и мир: общий план, персонаж у входа, комнаты тёмные", async ({ page }) => {
    test.setTimeout(240_000);
    await completeQuest(page);
    await page.getByRole("button", { name: "Сыграть ещё раз" }).click();
    await expectPhase(page, "prologue");
    // Пролог начался с общего плана: ни переключателя MFA, ни «Войти в офис», ни Тимура у входа, ни горящих комнат.
    await expect(page.getByRole("button", { name: "Дальше" })).toBeVisible();
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Войти в офис" })).toHaveCount(0);
    await expect(page.locator(".qw-hero-prologue")).toHaveCount(0);
    await expect(page.locator('.qw-room[data-lit="true"]')).toHaveCount(0);
    // Пролог проходится заново, и персонаж стоит у входа, а не в комнате прошлой игры.
    await page.getByRole("button", { name: "Дальше" }).click();
    const next = page.getByRole("button", { name: "Дальше" });
    for (let step = 1; step < campaign.prologue.lines.length; step += 1) await next.click();
    await page.getByRole("switch").click();
    await page.getByRole("button", { name: "Войти в офис" }).click();
    await expectPhase(page, "explore");
    const gate = GRAPH.nodes.get("gate")!;
    await expect
      .poll(async () =>
        page.locator(".qw-player").evaluate((el) => {
          const m = new DOMMatrix(getComputedStyle(el).transform);
          return [m.e, m.f];
        })
      )
      .toEqual([expect.closeTo(gate.x, 0), expect.closeTo(gate.y, 0)]);
    await expect(page.locator(".qw-bubble").filter({ hasText: prologueHero.name })).toHaveCount(0);
  });
});

test.describe("квест: prefers-reduced-motion", () => {
  test.skip(!isQuestTenant, "кампания в режиме cards: квест-сценарии не применимы");
  test.use({ reducedMotion: "reduce" });

  test("комната включается без полёта игрушки и без анимаций; игра проходится", async ({ page }) => {
    test.setTimeout(120_000);
    await startQuest(page);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const room = questRoomOrder[1];
    await playQuestRoom(page, room);
    await expect(page.locator(".qw-toy-fly")).toHaveCount(0);
    const animations = await page.locator(".qw-bonus, .qw-pointer-beacon, .flake").evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
    expect(new Set(animations).size).toBeLessThanOrEqual(1);
    expect([...new Set(animations)].every((name) => name === "none")).toBe(true);
  });
});

async function completeQuestFromRooms(page: import("@playwright/test").Page) {
  const { playAllQuestRooms, startQuestRush, playQuestRushToEnd } = await import("./support/quest");
  await playAllQuestRooms(page);
  await expect(page.getByRole("heading", { level: 2, name: "Финальный рывок!" })).toBeVisible();
  await startQuestRush(page);
  await playQuestRushToEnd(page);
  await expectPhase(page, "final", 40_000);
  await expect(finalResult(page)).toBeVisible();
}

/** Пролог без мыши: «Дальше», переключатель MFA и «Войти в офис» — всё через Tab и Enter/Space. */
async function startQuestWithKeyboard(page: import("@playwright/test").Page) {
  await page.goto(QUEST_URL);
  await expectPhase(page, "prologue");
  const next = page.getByRole("button", { name: "Дальше" });
  await expect(next).toBeFocused();
  await page.keyboard.press("Enter");
  for (let step = 1; step < campaign.prologue.lines.length; step += 1) {
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
  }
  const mfa = page.getByRole("switch");
  await focusByTab(page, mfa);
  await page.keyboard.press("Space");
  await expect(mfa).toBeChecked();
  const enter = page.getByRole("button", { name: "Войти в офис" });
  await focusByTab(page, enter);
  await page.keyboard.press("Enter");
  await expectPhase(page, "explore");
}
