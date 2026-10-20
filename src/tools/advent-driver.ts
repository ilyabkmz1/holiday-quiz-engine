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

/** Верный ответ на задание вместе с отправкой (кнопка подтверждения, если она у механики есть). */
export async function fillTask(page: Page, task: Task): Promise<void> {
  const payload = correctPayload(task);
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
