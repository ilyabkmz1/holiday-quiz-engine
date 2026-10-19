import { z } from "zod";

import type { Task } from "@/config/schema";
import { DomainError } from "@/domain/errors";

/** Ответ игрока на задание; форма зависит от типа задания. */
export type TaskPayload =
  | { optionId: string }
  | { optionIds: string[] }
  | { enabledIds: string[] }
  | { orderedIds: string[] };

export type TaskBase = 0 | 50 | 100;

export type TaskScore = {
  base: TaskBase;
  /** Нормализованный ответ, который сохраняется в БД. */
  payload: TaskPayload;
};

const idSchema = z.string().min(1).max(64);
const optionPayload = z.object({ optionId: idSchema }).strict();
const optionsPayload = z.object({ optionIds: z.array(idSchema).max(10) }).strict();
const enabledPayload = z.object({ enabledIds: z.array(idSchema).max(10) }).strict();
const orderPayload = z.object({ orderedIds: z.array(idSchema).max(10) }).strict();

function invalid(message: string): never {
  throw new DomainError("invalid", message);
}

function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    invalid("Ответ на задание заполнен неверно.");
  }
  return result.data;
}

function assertKnownUnique(chosen: string[], known: string[]): void {
  if (new Set(chosen).size !== chosen.length) {
    invalid("Варианты ответа не должны повторяться.");
  }
  const available = new Set(known);
  if (chosen.some((id) => !available.has(id))) {
    invalid("Выбран неизвестный вариант ответа.");
  }
}

/** Переключатели: 100 за точное совпадение, 50 при ровно одном неверно выставленном, иначе 0. */
function gradeSwitches(chosen: string[], correct: string[]): TaskBase {
  const chosenSet = new Set(chosen);
  const correctSet = new Set(correct);
  const mistakes =
    [...chosenSet].filter((id) => !correctSet.has(id)).length +
    [...correctSet].filter((id) => !chosenSet.has(id)).length;
  if (mistakes === 0) return 100;
  return mistakes === 1 ? 50 : 0;
}

/**
 * Сборка: слотов ровно столько, сколько верных карточек, поэтому ошибка — это карточка не из верных.
 * 100 без ошибок, 50 при ровно одной неверной карточке, иначе 0.
 */
function gradeCards(chosen: string[], correct: string[]): TaskBase {
  const wrong = chosen.filter((id) => !correct.includes(id)).length;
  if (wrong === 0) return 100;
  return wrong === 1 ? 50 : 0;
}

/** Проверяет форму ответа для типа задания и считает базу. Бросает DomainError("invalid"). */
export function scoreTask(task: Task, payload: unknown): TaskScore {
  switch (task.type) {
    case "pick": {
      const { optionId } = parse(optionPayload, payload);
      assertKnownUnique([optionId], task.options.map((option) => option.id));
      return { base: optionId === task.correctOptionId ? 100 : 0, payload: { optionId } };
    }
    case "phish": {
      const { optionId } = parse(optionPayload, payload);
      assertKnownUnique([optionId], task.letters.map((letter) => letter.id));
      return { base: optionId === task.fakeLetterId ? 100 : 0, payload: { optionId } };
    }
    case "build": {
      const { optionIds } = parse(optionsPayload, payload);
      if (optionIds.length !== task.slots) {
        invalid(`Нужно собрать ровно ${task.slots} карточки.`);
      }
      assertKnownUnique(optionIds, task.options.map((option) => option.id));
      // Порядок карточек в слотах не важен: считается только состав.
      return { base: gradeCards(optionIds, task.correctOptionIds), payload: { optionIds } };
    }
    case "access": {
      const { enabledIds } = parse(enabledPayload, payload);
      assertKnownUnique(enabledIds, task.switches.map((item) => item.id));
      return { base: gradeSwitches(enabledIds, task.correctEnabledIds), payload: { enabledIds } };
    }
    case "order": {
      const { orderedIds } = parse(orderPayload, payload);
      if (orderedIds.length !== task.items.length) {
        invalid("Нужно расставить все карточки.");
      }
      assertKnownUnique(orderedIds, task.items.map((item) => item.id));
      const exact = orderedIds.every((id, index) => id === task.correctOrder[index]);
      return { base: exact ? 100 : 0, payload: { orderedIds } };
    }
  }
}

/**
 * Верные идентификаторы для разбора после ответа: для `order` — в правильном порядке,
 * для `access` — включённые переключатели, для остальных — верные карточки или письмо-подделка.
 */
export function correctIds(task: Task): string[] {
  switch (task.type) {
    case "pick":
      return [task.correctOptionId];
    case "phish":
      return [task.fakeLetterId];
    case "build":
      return [...task.correctOptionIds];
    case "access":
      return [...task.correctEnabledIds];
    case "order":
      return [...task.correctOrder];
  }
}
