import type { Task } from "@/config/schema";
import type { TaskPayload } from "@/domain/tasks";

// Ответы на задания «как их знает сервер»: для тестов и для симуляции прохождения в `quiz:check`.
/** Верный ответ на задание — по конфигурации, как его знает только сервер. */
export function correctPayload(task: Task): TaskPayload {
  switch (task.type) {
    case "pick":
      return { optionId: task.correctOptionId };
    case "phish":
      return { optionId: task.fakeLetterId };
    case "build":
      return { optionIds: [...task.correctOptionIds] };
    case "access":
      return { enabledIds: [...task.correctEnabledIds] };
    case "order":
      return { orderedIds: [...task.correctOrder] };
  }
}

/** Ответ, дающий ровно 50: одна неверная карточка или один неверный переключатель. Для остальных типов `null`. */
export function partialPayload(task: Task): TaskPayload | null {
  if (task.type === "build") {
    const trap = task.options.find((option) => !task.correctOptionIds.includes(option.id))!;
    return { optionIds: [...task.correctOptionIds.slice(0, -1), trap.id] };
  }
  if (task.type === "access") {
    return { enabledIds: task.correctEnabledIds.slice(0, -1) };
  }
  return null;
}

/** Ответ, дающий 0 (допустимый по форме, но неверный). */
export function wrongPayload(task: Task): TaskPayload {
  switch (task.type) {
    case "pick": {
      const wrong = task.options.find((option) => option.id !== task.correctOptionId)!;
      return { optionId: wrong.id };
    }
    case "phish": {
      const wrong = task.letters.find((letter) => letter.id !== task.fakeLetterId)!;
      return { optionId: wrong.id };
    }
    case "build": {
      const traps = task.options.filter((option) => !task.correctOptionIds.includes(option.id));
      const fillers = task.options.filter((option) => !traps.includes(option));
      return { optionIds: [...traps, ...fillers].slice(0, task.slots).map((option) => option.id) };
    }
    case "access": {
      // Включить только ловушки: ошибок не меньше двух.
      const traps = task.switches.filter((item) => !task.correctEnabledIds.includes(item.id));
      return { enabledIds: traps.map((item) => item.id) };
    }
    case "order":
      return { orderedIds: [...task.correctOrder].reverse() };
  }
}
