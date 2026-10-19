/**
 * Разбор брифа клиента (`docs/brief-template.md`): строки вида «Ключ: значение» (маркдаун-обрамление `-`, `*`, `**`
 * игнорируется). Понимаются только известные ключи; пустое значение или «—» считается незаполненным.
 */
export type BriefFields = Partial<{
  businessName: string;
  mark: string;
  tagline: string;
  operator: string;
  domain: string;
  quizTitle: string;
  startsAt: string;
  claimEndsAt: string;
  verificationEndsAt: string;
  colorBg: string;
  colorPanel: string;
  colorAccent: string;
  colorHighlight: string;
  font: string;
  mode: string;
}>;

const KEYS: Record<string, keyof BriefFields> = {
  "название бизнеса": "businessName",
  "отметка логотипа": "mark",
  "слоган": "tagline",
  "юрлицо": "operator",
  "домен": "domain",
  "название квиза": "quizTitle",
  "начало кампании": "startsAt",
  "приём заявок до": "claimEndsAt",
  "подтверждение до": "verificationEndsAt",
  "цвет фона": "colorBg",
  "цвет панелей": "colorPanel",
  "цвет акцента": "colorAccent",
  "цвет подсветки": "colorHighlight",
  "шрифт": "font",
  "режим": "mode"
};

export function parseBrief(text: string): BriefFields {
  const result: BriefFields = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\s>*-]+/, "").replace(/\*\*/g, "");
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = KEYS[line.slice(0, colon).trim().toLowerCase().replace(/\s*\(.*\)$/, "")];
    const value = line.slice(colon + 1).trim();
    if (!key || !value || value === "—" || /^(todo|\.\.\.|_+)$/i.test(value)) continue;
    result[key] = value;
  }
  return result;
}

/** Дата «20.12.2026» или ISO → ISO с московским поясом. */
export function toIsoMoscow(value: string, endOfDay = false): string | null {
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
  if (ru) return `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}T${endOfDay ? "23:59:59" : "00:00:00"}+03:00`;
  return /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(value.trim()) ? value.trim() : null;
}

type Pack = { hosts?: string[]; campaign: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Переносит поля брифа в заготовку пакета. Возвращает список перенесённых полей. */
export function applyBrief(pack: Pack, fields: BriefFields): string[] {
  const applied: string[] = [];
  const set = (label: string, apply: () => void) => {
    apply();
    applied.push(label);
  };
  const { campaign } = pack;
  if (fields.businessName) {
    set("brand.name, brand.wordmark", () => {
      campaign.brand.name = fields.businessName;
      campaign.brand.wordmark = fields.businessName!.slice(0, 30);
    });
    if (!fields.mark) set("brand.mark (из названия)", () => { campaign.brand.mark = fields.businessName!.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "Q"; });
  }
  if (fields.mark) set("brand.mark", () => { campaign.brand.mark = fields.mark!.slice(0, 4); });
  if (fields.tagline) set("brand.tagline", () => { campaign.brand.tagline = fields.tagline; });
  if (fields.operator) set("legal.operatorName", () => { campaign.legal.operatorName = fields.operator; });
  if (fields.domain) set("hosts", () => { pack.hosts = [fields.domain!.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase()]; });
  if (fields.quizTitle) set("campaign.title", () => { campaign.title = fields.quizTitle; });
  for (const [field, key, end] of [["startsAt", "startsAt", false], ["claimEndsAt", "claimEndsAt", true], ["verificationEndsAt", "verificationEndsAt", true]] as const) {
    const iso = fields[field] ? toIsoMoscow(fields[field]!, end) : null;
    if (iso) set(`campaign.${key}`, () => { campaign[key] = iso; });
  }
  const color = (value: string | undefined) => (value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null);
  for (const [field, target] of [["colorBg", "bg"], ["colorPanel", "panel"], ["colorAccent", "accent"], ["colorHighlight", "highlight"]] as const) {
    const hex = color(fields[field]);
    if (hex) set(`brand.colors.${target}`, () => { campaign.brand.colors[target] = hex; });
  }
  if (fields.font) set("brand.font", () => { campaign.brand.font = fields.font!.toLowerCase(); });
  if (fields.mode === "cards" || fields.mode === "quest") set("campaign.mode", () => { campaign.mode = fields.mode; });
  return applied;
}
