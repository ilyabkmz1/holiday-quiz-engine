/**
 * Действия игрока в интерфейсе адвента для автоматических сценариев (E2E и скриншоты `quiz:shots --day`): варианты выбираются
 * по тексту из пакета, ответ берётся из конфигурации задания. Только для разработки: в рантайме игры не используется.
 */
import type { Locator, Page } from "@playwright/test";

import type { Task } from "@/config/schema";
import { correctPayload } from "@/domain/solve";

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function control(page: Page, group: string, title: string, role: "button" | "switch" = "button"): Locator {
  return page.getByRole("group", { name: group }).getByRole(role, { name: title, exact: true });
}

/**
 * Названия элементов «Витрины» (обложки заданий и листание реплик): берутся из `copy` пакета. Без них драйвер ведёт игрока
 * по штатным механикам календаря.
 */
export type StorefrontNames = { pickTitle: string; buildTitle: string; buildSubmit: string; bubbleNext: string };

/** Копия пакета → названия элементов «Витрины» для драйвера. */
export function storefrontNames(copy: { skinPickTitle: string; skinBuildTitle: string; skinBuildSubmit: string; bubbleNext: string }): StorefrontNames {
  return { pickTitle: copy.skinPickTitle, buildTitle: copy.skinBuildTitle, buildSubmit: copy.skinBuildSubmit, bubbleNext: copy.bubbleNext };
}

/**
 * Дослушать реплики героя и нажать завершающую кнопку шага (`doneLabel`). В «Витрине» реплики листаются кнопкой «Листать дальше»
 * (`names.bubbleNext`), в календаре реплик-страниц нет: сразу завершающая кнопка.
 */
export async function finishSpeech(page: Page, doneLabel: string, lines: number, names?: StorefrontNames): Promise<void> {
  const dialog = page.getByRole("dialog");
  if (names) for (let index = 1; index < lines; index += 1) await dialog.getByRole("button", { name: names.bubbleNext, exact: true }).click();
  await dialog.getByRole("button", { name: doneLabel, exact: true }).click();
}

/** Верный ответ на задание вместе с отправкой (кнопка подтверждения, если она у механики есть). */
export async function fillTask(page: Page, task: Task, names?: StorefrontNames): Promise<void> {
  const payload = correctPayload(task);
  if (names && (task.type === "pick" || task.type === "build" || task.type === "order")) {
    // Обложки «Витрины»: предметы на прилавке (pick) и «собери» с чипами-ингредиентами и кнопкой «Готово» (build, order).
    const dialog = page.getByRole("dialog");
    if (task.type === "pick") {
      const id = (payload as { optionId: string }).optionId;
      await dialog.getByRole("list", { name: names.pickTitle }).getByRole("button", { name: task.options.find((option) => option.id === id)!.title, exact: true }).click();
      return;
    }
    const ids = task.type === "build" ? (payload as { optionIds: string[] }).optionIds : (payload as { orderedIds: string[] }).orderedIds;
    const entries = task.type === "build" ? task.options : task.items;
    for (const id of ids) await dialog.getByRole("list", { name: names.buildTitle }).getByRole("button", { name: entries.find((entry) => entry.id === id)!.title, exact: true }).click();
    await dialog.getByRole("button", { name: names.buildSubmit, exact: true }).click();
    return;
  }
  switch (task.type) {
    case "pick": {
      const id = (payload as { optionId: string }).optionId;
      await control(page, "Варианты ответа", task.options.find((option) => option.id === id)!.title).click();
      return;
    }
    case "phish": {
      const id = (payload as { optionId: string }).optionId;
      const letter = task.letters.find((item) => item.id === id)!;
      await page.getByRole("group", { name: "Входящие письма" }).getByRole("button", { name: new RegExp(escapeRegExp(letter.address)) }).click();
      await page.getByRole("button", { name: "Это подделка — в карантин" }).click();
      return;
    }
    case "build": {
      for (const id of (payload as { optionIds: string[] }).optionIds) {
        await control(page, "Карточки сценария", task.options.find((option) => option.id === id)!.title).click();
      }
      await page.getByRole("button", { name: "Запустить сценарий", exact: true }).click();
      return;
    }
    case "access": {
      for (const id of (payload as { enabledIds: string[] }).enabledIds) {
        await control(page, "Настройки доступа", task.switches.find((item) => item.id === id)!.title, "switch").click();
      }
      await page.getByRole("button", { name: "Применить настройки" }).click();
      return;
    }
    case "order": {
      for (const id of (payload as { orderedIds: string[] }).orderedIds) {
        await control(page, "Шаги", task.items.find((item) => item.id === id)!.title).click();
      }
      await page.getByRole("button", { name: "Подтвердить порядок" }).click();
      return;
    }
  }
}
