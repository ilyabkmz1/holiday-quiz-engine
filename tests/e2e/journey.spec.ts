import { campaign, copy, rooms } from "./support/tenant";
import { exportedRowsFor, expectClaimSent, submitClaim, uniqueEmail } from "./support/claim";
import { expect, test } from "./support/fixtures";
import {
  CARDS_URL,
  gameSessionId,
  mapHeading,
  openClaim,
  openRush,
  playRoom,
  playRushToEnd,
  roomSpot,
  rushButton,
  sessionState,
  shuffledRoomOrder,
  startButton,
  startGame
} from "./support/game";
import { verificationLinkFor } from "./support/mailpit";

test("лендинг показывает цифры из конфигурации и ведёт в пролог", async ({ page }) => {
  await page.goto(CARDS_URL);
  await expect(page.getByRole("heading", { level: 1, name: campaign.title })).toBeVisible();
  await expect(page.getByText(String(rooms.length * 3), { exact: true })).toBeVisible();
  await startButton(page).click();
  await expect(page.getByText(campaign.prologue.lines[0])).toBeVisible();
});

test("полный путь: пролог → все комнаты в нестандартном порядке → рывок → финал → заявка → письмо → подтверждение", async ({ page, request }) => {
  test.setTimeout(180_000);
  await startGame(page);

  // Карта: кнопка на каждую комнату, ни одна не заблокирована, рывок ещё закрыт.
  for (const room of rooms) await expect(roomSpot(page, room)).toBeEnabled();
  await expect(rushButton(page)).toHaveCount(0);

  for (const [index, room] of shuffledRoomOrder.entries()) {
    await playRoom(page, room);
    await expect(page.getByLabel(copy.ornamentsMapLabel).getByRole("img", { name: /на ёлке/ })).toHaveCount(index + 1);
    expect((await rushButton(page).count()) > 0).toBe(index === shuffledRoomOrder.length - 1);
  }
  await expect(page.getByText(/^Очков: [1-9]/).first()).toBeAttached();

  await openRush(page);
  await playRushToEnd(page);

  const result = page.getByLabel("Результат");
  await expect(result).toBeVisible({ timeout: 30_000 });
  const { session } = await sessionState(page);
  expect(session.status).toBe("completed");
  const final = session.final!;
  await expect(result.getByRole("heading", { level: 1, name: final.level.title })).toBeVisible();
  await expect(result.getByLabel(`${final.score} очков`)).toBeVisible();
  await expect(page.getByLabel(copy.ornamentsAria).getByRole("img")).toHaveCount(rooms.length);
  for (const summary of final.rooms) {
    const room = rooms.find((candidate) => candidate.id === summary.roomId)!;
    await expect(page.getByLabel("Очки по комнатам").getByRole("listitem").filter({ hasText: room.title })).toBeVisible();
  }

  // Заявка на приз и подтверждение по письму.
  await openClaim(page);
  await expect(page.getByText("Подарок — один на email")).toBeVisible();
  const email = uniqueEmail("journey");
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
  expect(rows[0]).toContain(final.level.title);
});

test("карточка «Поделиться» показывает результат и копирует ссылку, если Web Share недоступен", async ({ page, context }) => {
  const { reachFinalViaApi } = await import("./support/api");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await reachFinalViaApi(page);
  const { session } = await sessionState(page);
  await page.evaluate(() => Object.defineProperty(navigator, "share", { value: undefined, configurable: true }));
  await page.getByRole("button", { name: "Поделиться результатом" }).click();
  const card = page.getByLabel("Карточка результата");
  await expect(card.getByText(session.final!.level.title)).toBeVisible();
  await page.getByRole("button", { name: "Поделиться", exact: true }).click();
  await expect(page.getByText(/скопированы|Скопируйте ссылку/)).toBeVisible();
  await page.getByRole("button", { name: "← К результату" }).click();
  await expect(page.getByLabel("Результат")).toBeVisible();
});

test("«Сыграть ещё раз» начинает новую игру", async ({ page }) => {
  const { reachFinalViaApi } = await import("./support/api");
  await reachFinalViaApi(page);
  const first = await gameSessionId(page);
  await page.getByRole("button", { name: "Сыграть ещё раз" }).click();
  await expect(startButton(page)).toBeVisible();
  await startGame(page);
  expect(await gameSessionId(page)).not.toBe(first);
  await expect(mapHeading(page)).toBeVisible();
});
