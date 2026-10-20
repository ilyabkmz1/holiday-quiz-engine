/** Письмо-напоминание адвента (A5): HTML и текстовая версии. Тексты пакета подставляются экранированными. */

export type ReminderMailVars = {
  /** Тема после подстановки `{day}` и `{teaser}`. */
  subject: string;
  /** Скрытый предпросмотр после подстановки. */
  preheader: string;
  brandName: string;
  colors: {
    /** Фон шапки. */
    bg: string;
    /** Цвет названия бренда на шапке. */
    ink: string;
    /** Кнопка. */
    accent: string;
    /** Текст на кнопке. */
    onAccent: string;
    /** Фон карточки письма. */
    paper: string;
    /** Текст на карточке. */
    paperInk: string;
  };
  dayNumber: number;
  dayTitle: string;
  teaser: string;
  /** Абзац варианта «возвращение». */
  comebackText?: string;
  /** Абзац о том, что пропущенный день можно догнать. */
  catchUpText?: string;
  buttonLabel: string;
  /** Одноразовый вход на сайт. В логи не попадает. */
  link: string;
  progress: { opened: number; total: number };
  /** Страница отписки (кнопка «Отписаться»). */
  unsubscribeUrl: string;
  /** Адрес RFC 8058: POST без Origin, только по токену. */
  unsubscribeOneClickUrl: string;
  operatorName: string;
  /** Адрес, ИНН и прочие реквизиты оператора. */
  operatorDetails?: string;
};

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Цвет — только `#RRGGBB`; всё остальное заменяется запасным значением (защита от разметки в стиле). */
function safeColor(value: string, fallback: string): string {
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : fallback;
}

/** Ссылки письма — только http и https. */
function safeUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : "#";
}

export function renderReminderMail(vars: ReminderMailVars): { subject: string; text: string; html: string; headers: Record<string, string> } {
  const progress = `Открыто ${vars.progress.opened} из ${vars.progress.total}`;
  const operator = [vars.operatorName, vars.operatorDetails].filter(Boolean).join(", ");
  const e = escapeHtml;
  const c = {
    bg: safeColor(vars.colors.bg, "#1f2430"),
    ink: safeColor(vars.colors.ink, "#ffffff"),
    accent: safeColor(vars.colors.accent, "#2a6df4"),
    onAccent: safeColor(vars.colors.onAccent, "#ffffff"),
    paper: safeColor(vars.colors.paper, "#ffffff"),
    paperInk: safeColor(vars.colors.paperInk, "#1f2430")
  };
  const total = Math.max(1, vars.progress.total);
  const percent = Math.min(100, Math.round((vars.progress.opened / total) * 100));
  const paragraphs = [vars.comebackText, vars.catchUpText].filter((value): value is string => Boolean(value));

  const html =
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${e(vars.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${c.bg};">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${e(vars.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.bg};"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">` +
    `<tr><td style="padding:0 4px 14px;font:700 18px/1.2 Arial,Helvetica,sans-serif;color:${c.ink};">${e(vars.brandName)}</td></tr>` +
    `<tr><td style="background:${c.paper};border-radius:14px;padding:28px 24px;font:16px/1.5 Arial,Helvetica,sans-serif;color:${c.paperInk};">` +
    `<p style="margin:0 0 6px;font:700 13px/1.2 Arial,Helvetica,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${c.accent};">№ ${vars.dayNumber}</p>` +
    `<h1 style="margin:0 0 12px;font:700 24px/1.25 Arial,Helvetica,sans-serif;color:${c.paperInk};">${e(vars.dayTitle)}</h1>` +
    `<p style="margin:0 0 16px;">${e(vars.teaser)}</p>` +
    paragraphs.map((text) => `<p style="margin:0 0 16px;">${e(text)}</p>`).join("") +
    `<p style="margin:24px 0;"><a href="${e(safeUrl(vars.link))}" style="display:inline-block;background:${c.accent};color:${c.onAccent};text-decoration:none;font:700 16px/1 Arial,Helvetica,sans-serif;padding:15px 24px;border-radius:10px;">${e(vars.buttonLabel)}</a></p>` +
    `<p style="margin:0 0 6px;font-size:14px;">${e(progress)}</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#e4e6ec;border-radius:4px;height:8px;line-height:8px;font-size:0;">` +
    `<div style="width:${percent}%;background:${c.accent};height:8px;border-radius:4px;">&nbsp;</div></td></tr></table>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 4px 0;font:12px/1.5 Arial,Helvetica,sans-serif;color:${c.ink};opacity:.85;">` +
    `Вы получили это письмо, потому что включили напоминания (${e(vars.brandName)}). ` +
    `<a href="${e(safeUrl(vars.unsubscribeUrl))}" style="color:${c.ink};text-decoration:underline;">Отписаться</a><br>` +
    `Оператор: ${e(operator)}` +
    `</td></tr></table></td></tr></table></body></html>`;

  const text = [
    `${vars.brandName}: ${vars.dayTitle} (№ ${vars.dayNumber})`,
    "",
    vars.teaser,
    ...paragraphs.flatMap((paragraph) => ["", paragraph]),
    "",
    `${vars.buttonLabel}: ${vars.link}`,
    "",
    progress,
    "",
    "--",
    `Вы получили это письмо, потому что включили напоминания (${vars.brandName}).`,
    `Отписаться: ${vars.unsubscribeUrl}`,
    `Оператор: ${operator}`
  ].join("\n");

  return {
    subject: vars.subject,
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${vars.unsubscribeOneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    }
  };
}
