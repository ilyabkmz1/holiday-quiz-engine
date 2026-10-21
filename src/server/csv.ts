import type { AdventAnalytics, AnalyticsDay, AnalyticsReward } from "@/types/advent-analytics";

export type ClaimExportRow = {
  name: string;
  normalizedEmail: string;
  company: string;
  score: number;
  rewardTierTitle: string;
  verifiedAt: Date;
};

/** Текст, который Excel и Google Sheets примут за формулу (в том числе после пробелов), получает впереди апостроф. */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) || /^\s+[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number): string {
  const stringValue = neutralizeFormula(String(value));
  return `"${stringValue.replaceAll('"', '""')}"`;
}

export function claimsToCsv(rows: ClaimExportRow[]): string {
  const header = ["Имя", "Email", "Компания", "Баллы", "Уровень", "Подтверждено"];
  const body = rows.map((row) =>
    [
      row.name,
      row.normalizedEmail,
      row.company,
      row.score,
      row.rewardTierTitle,
      row.verifiedAt.toISOString()
    ]
      .map(csvCell)
      .join(",")
  );
  return `\uFEFF${[header.map(csvCell).join(","), ...body].join("\r\n")}\r\n`;
}

export type GrantExportRow = {
  id: string;
  rewardId: string;
  rewardLabel: string;
  day: number;
  source: string;
  status: string;
  createdAt: Date;
  redeemedAt: Date | null;
  expiresAt: Date | null;
};

/**
 * Выдачи наград адвента для оператора. Без email, кодов и ключей участника: идентификатор выдачи нужен для сверки с кассой.
 * Те же правила, что у `claimsToCsv`: BOM для Excel, CRLF, ячейки в кавычках и защита от формул (`=`, `+`, `-`, `@`).
 */
export function grantsToCsv(rows: GrantExportRow[]): string {
  const header = ["ID выдачи", "Награда (id)", "Награда", "День", "Источник", "Статус", "Выдана", "Погашена", "Действует до"];
  const body = rows.map((row) =>
    [
      row.id,
      row.rewardId,
      row.rewardLabel,
      row.day,
      row.source,
      row.status,
      row.createdAt.toISOString(),
      row.redeemedAt?.toISOString() ?? "",
      row.expiresAt?.toISOString() ?? ""
    ]
      .map(csvCell)
      .join(",")
  );
  return `\uFEFF${[header.map(csvCell).join(","), ...body].join("\r\n")}\r\n`;
}

type Cell = string | number | null;

/** Числа выводятся как есть (счётчики и доли неотрицательны), текст проходит защиту от формул. */
function tableToCsv(header: string[], rows: Cell[][]): string {
  const cell = (value: Cell) => (typeof value === "number" ? `"${value}"` : csvCell(value ?? ""));
  const body = rows.map((row) => row.map(cell).join(","));
  return `\uFEFF${[header.map(csvCell).join(","), ...body].join("\r\n")}\r\n`;
}

const ratio = (value: number | null): Cell => (value === null ? "" : Math.round(value * 10000) / 10000);

/** Метрики адвента по дням (без персональных данных); доли — числа от 0 до 1. */
export function daysMetricsToCsv(days: AnalyticsDay[]): string {
  return tableToCsv(
    ["День", "Дата", "Название", "Статус окна", "Открыли в свой день", "Догнали", "Открыли всего", "Активных", "Пропустили", "Закрыли день целиком", "Доля в свой день", "Играли раньше", "Из них в свой день", "Доля игравших раньше"],
    days.map((day) => {
      const future = day.status === "future";
      return [day.day, day.date, day.title, day.status, day.onTime, day.caughtUp, day.opened, future ? "" : day.active, day.missed, day.completed, ratio(day.onTimeShare), future ? "" : day.returning, future ? "" : day.returningOnTime, ratio(day.returningShare)];
    })
  );
}

/** Награды: выдано, погашено, истекли, остатки. */
export function rewardsMetricsToCsv(rewards: AnalyticsReward[]): string {
  return tableToCsv(
    ["Награда (id)", "Награда", "Тип", "Выдано", "Погашено", "Истекли", "Доля погашения", "Остаток удачи", "Свободных кодов", "Кодов в пуле"],
    rewards.map((reward) => [reward.rewardId, reward.label, reward.kind, reward.issued, reward.redeemed, reward.expired, ratio(reward.redeemShare), reward.stockLeft, reward.codesFree, reward.codesTotal])
  );
}

/** Когорты по дню первого визита; малые когорты (меньше порога) без чисел. */
export function cohortsMetricsToCsv(cohorts: AdventAnalytics["cohorts"]): string {
  return tableToCsv(
    ["Первый визит", "Участников", ...cohorts.offsets.flatMap((offset) => [`D${offset}, человек`, `D${offset}, доля`])],
    cohorts.rows.map((row) => [row.date, row.size, ...row.cells.flatMap((cell) => [cell.count, ratio(cell.share)])])
  );
}
