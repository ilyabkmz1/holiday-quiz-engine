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
