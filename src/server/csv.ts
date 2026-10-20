export type ClaimExportRow = {
  name: string;
  normalizedEmail: string;
  company: string;
  score: number;
  rewardTierTitle: string;
  verifiedAt: Date;
};

function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
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
