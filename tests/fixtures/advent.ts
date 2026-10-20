/* eslint-disable @typescript-eslint/no-explicit-any -- фикстура намеренно слабо типизирована: тесты ломают её по полям */
import demoCoffee from "@tenants/demo-coffee/pack.json" with { type: "json" };

import type { Task } from "@/config/schema";

type DayDraft = { title: string; teaser: string; heroId: string; lines: string[] };

/** 12 дней, 20–31.12.2026: сюжет кофейни «Зерно», по одному заданию, подарки и три коробки удачи. */
const DAYS: DayDraft[] = [
  { title: "Ароматный старт", teaser: "Откроем зёрна и начнём путь к празднику", heroId: "mila", lines: ["Привет! Я Мила. Сегодня мы запускаем адвент в «Зерне».", "Каждый день — новая дверь, новая история и маленький подарок."] },
  { title: "Секрет свежести", teaser: "Как отличить свежий кофе от залежавшегося", heroId: "timur", lines: ["Тимур обжаривает кофе раз в неделю и знает про зёрна всё.", "Он просит помочь гостю с вопросом."] },
  { title: "Хранение зёрен", teaser: "Где зёрна живут до заварки", heroId: "timur", lines: ["На складе стало тесно.", "Соберём правильное хранение."] },
  { title: "Коробка сюрпризов", teaser: "Сегодня решает удача", heroId: "lena", lines: ["Лена нашла в кладовой три коробки.", "В одной из них что-то особенное."] },
  { title: "Идеальный эспрессо", teaser: "Что нужно для первой чашки дня", heroId: "mila", lines: ["Мила настраивает кофемашину.", "Помогите ей не ошибиться."] },
  { title: "Умная кофемашина", teaser: "Что включить, а что оставить выключенным", heroId: "lena", lines: ["Лена обновляет кофемашину перед праздниками.", "Нужно включить только полезное."] },
  { title: "Порядок приготовления", teaser: "Шаги к чашке без ошибок", heroId: "mila", lines: ["Гость торопится.", "Расставим шаги по порядку."] },
  { title: "Вторая коробка", teaser: "Ещё один шанс на сюрприз", heroId: "lena", lines: ["Лена вернулась с новыми коробками.", "Выбирайте внимательно."] },
  { title: "Забота о гостях", teaser: "Как скрасить ожидание в очереди", heroId: "lena", lines: ["Очередь растёт, а Лена не теряет улыбку.", "Подскажите ей, что предложить гостям."] },
  { title: "Молочная пенка", teaser: "Секреты нежной текстуры", heroId: "lena", lines: ["Мила учит взбивать молоко.", "Помогите выбрать правильный ответ."] },
  { title: "Программа лояльности", teaser: "Как копить и тратить баллы", heroId: "mila", lines: ["Гости любят копить баллы.", "Соберите программу из подходящих карточек."] },
  { title: "Праздничная полночь", teaser: "Финальная коробка и подарок", heroId: "timur", lines: ["Тимур разливает последние чашки года.", "Осталась одна коробка — откроем её вместе."] }
];

/** Какие задания демо-пакета ставим на какой день (дни 4, 8 и 12 отданы удаче). */
const TASK_DAYS: Record<number, string> = {
  1: "beans-fresh",
  2: "beans-store",
  3: "beans-path",
  5: "brew-shot",
  6: "brew-open",
  7: "brew-flat",
  9: "care-wait",
  10: "care-milk",
  11: "care-loyal"
};
const LUCK_DAYS = new Set([4, 8, 12]);
const PROMO_DAYS = new Set([1, 5, 9]);

/**
 * Валидная конфигурация адвента в духе horeca: 12 дней, 20–31.12.2026, Europe/Moscow, догоняние на 1 день,
 * подарок на кассе, три коробки удачи с гарантированным утешительным призом. Каждый вызов возвращает новую копию:
 * тесты ломают её по одному полю. Бренд, героев и задания берёт из демо-пакета кофейни.
 */
export function adventFixture(): Record<string, any> {
  const demo = structuredClone(demoCoffee.campaign) as unknown as {
    brand: unknown;
    story: unknown;
    legal: Record<string, unknown>;
    heroes: unknown;
    rooms: Array<{ tasks: Task[] }>;
  };
  const tasks = new Map(demo.rooms.flatMap((room) => room.tasks).map((task) => [task.id, task]));

  return {
    slug: "zerno-advent-2026",
    title: "Адвент кофейни «Зерно»",
    subtitle: "12 дверей до Нового года",
    intro: "С 20 по 31 декабря каждый день открывается новая дверь: история, задание и подарок на кассе.",
    brand: demo.brand,
    story: demo.story,
    legal: { ...demo.legal, operatorDetails: "ИНН 000000000000 (демо), г. Москва; privacy@zerno.example" },
    heroes: demo.heroes,
    presentation: "calendar",
    schedule: {
      timezone: "Europe/Moscow",
      startDate: "2026-12-20",
      days: 12,
      unlockHour: 0,
      finaleAt: "2027-01-01T00:00:00+03:00",
      claimEndsAt: "2027-01-14T23:59:59+03:00",
      catchUp: { window: 1 },
      rewardOnlyOnDay: true
    },
    streak: {
      endowedDay: true,
      freezes: 1,
      comebackBonusRewardId: "comeback-gift",
      goals: [
        { opened: 4, rewardId: "goal-gift" },
        { opened: 8, rewardId: "final-entry" }
      ]
    },
    days: DAYS.map((draft, index) => {
      const n = index + 1;
      const blocks: unknown[] = [{ type: "story", lines: draft.lines.slice(0, 1) }];
      if (TASK_DAYS[n]) blocks.push({ type: "task", task: tasks.get(TASK_DAYS[n]) });
      if (LUCK_DAYS.has(n)) {
        blocks.push({
          type: "luck",
          choices: 3,
          pool: [
            { rewardId: "luck-a", weight: 7 },
            { rewardId: "luck-b", weight: 3 }
          ]
        });
      }
      if (PROMO_DAYS.has(n)) blocks.push({ type: "promo", rewardId: "daily-gift" });
      return {
        n,
        title: draft.title,
        teaser: draft.teaser,
        heroId: draft.heroId,
        chapter: { lines: draft.lines },
        blocks: blocks.slice(0, 3),
        ...(LUCK_DAYS.has(n) ? {} : { rewardId: "daily-gift" })
      };
    }),
    rewards: [
      { id: "daily-gift", kind: "gift", label: "Напиток или десерт дня", description: "Покажите код на кассе.", codes: { generated: { prefix: "ZR", length: 6 } }, validDays: 2, redeem: "cashier" },
      { id: "comeback-gift", kind: "gift", label: "Угощение «С возвращением»", description: "Подарок тем, кто вернулся после пропуска.", codes: { generated: { prefix: "BACK", length: 5 } }, validDays: 2, redeem: "cashier" },
      { id: "goal-gift", kind: "gift", label: "Десерт за серию", description: "Подарок за четыре открытые двери.", codes: { generated: { prefix: "SET", length: 5 } }, validDays: 3, redeem: "cashier" },
      { id: "luck-a", kind: "gift", label: "Печенье к кофе", description: "Утешительный приз удачи.", codes: { generated: { prefix: "LUCK", length: 5 } }, validDays: 2, redeem: "cashier" },
      { id: "luck-b", kind: "gift", label: "Кофе в подарок", description: "Редкий приз удачи.", codes: { generated: { prefix: "TOP", length: 5 } }, validDays: 2, stock: 30, redeem: "cashier" },
      { id: "final-entry", kind: "finalEntry", label: "Участие в финальном розыгрыше", description: "Главный приз кофейни.", redeem: "none" }
    ],
    luck: { skin: "boxes", fallbackRewardId: "luck-a" },
    reminders: { channel: "email", sendAtLocal: "08:30", subject: "Дверь {day} открыта: {teaser}", preheader: "Подарок дня ждёт на кассе" },
    audience: { kind: "customers", leaderboard: "off" }
  };
}

/** Пакет-обёртка вокруг фикстуры для тестов `adventPackSchema`. */
export function adventPackFixture(): Record<string, any> {
  return { experience: "advent", tenant: "zerno-advent", hosts: ["advent.zerno.test"], worldId: "snow-globe", profile: "horeca", advent: adventFixture() };
}
