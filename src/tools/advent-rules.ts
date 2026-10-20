/**
 * Правила акции для `quiz:rules`: черновик `tenants/<slug>/rules.md` из данных пакета (организатор, сроки, порядок участия,
 * призы и выдача, сроки действия кодов, персональные данные). Это заготовка для юриста заказчика, а не юридический документ:
 * в начале стоит пометка «требует утверждения», которую снимают после утверждения (`quiz:check` предупреждает, пока она есть).
 */
import type { AdventPack } from "@/config/pack";
import type { AdventReward } from "@/config/advent-schema";
import { NDFL_THRESHOLD_RUB, dayUnlockAt } from "@/domain/advent";

const KIND: Record<AdventReward["kind"], string> = { promo: "промокод", gift: "подарок", points: "баллы", finalEntry: "участие в финальном розыгрыше" };

function date(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone }).format(new Date(iso));
}
function dateTime(iso: string | Date, timeZone: string): string {
  return `${date(iso, timeZone)}, ${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso))}`;
}
function plural(n: number, forms: [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  return mod10 === 1 ? forms[0] : mod10 >= 2 && mod10 <= 4 ? forms[1] : forms[2];
}

function redeemText(reward: AdventReward): string {
  switch (reward.redeem) {
    case "online":
      return `на сайте${reward.url ? `: ${reward.url}` : ""}`;
    case "cashier":
      return "на кассе: участник показывает код или личный QR-код, кассир отмечает награду использованной";
    case "both":
      return `на сайте${reward.url ? ` (${reward.url})` : ""} или на кассе по коду или личному QR-коду`;
    default:
      // Баллы начисляются сами; подарок или участие в розыгрыше без погашения вручают как-то иначе — это решает заказчик.
      return reward.kind === "points" ? "отдельных действий для получения не требуется: баллы начисляются автоматически" : "порядок вручения: *заполнить (где, когда и как участник получает приз)*";
  }
}

/** Ячейка таблицы Markdown: `|` и перевод строки ломают таблицу. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

const LUCK_ACTION: Record<string, string> = { boxes: "выбор коробки", wheel: "вращение колеса", scratch: "стирание карточки" };

function validityText(reward: AdventReward): string {
  if (reward.codes === undefined) return "срок не применяется";
  return reward.validDays === undefined ? "срок действия не ограничен" : `${reward.validDays} ${plural(reward.validDays, ["день", "дня", "дней"])} с момента выдачи кода`;
}

function catchUpText(pack: AdventPack): string {
  const { catchUp, rewardOnlyOnDay } = pack.advent.schedule;
  const rule =
    catchUp === "none"
      ? "Пропущенный день открыть нельзя."
      : catchUp === "all"
        ? "Пропущенный день можно открыть в любой момент до завершения акции."
        : `Пропущенный день можно открыть в течение ${catchUp.window} ${plural(catchUp.window, ["дня", "дней", "дней"])} после его дня.`;
  return catchUp === "none" ? rule : `${rule} ${rewardOnlyOnDay ? "За день, открытый с опозданием, награда дня не выдаётся: остаётся история и задание." : "Награда дня за день, открытый с опозданием, выдаётся."}`;
}

export function buildRules(pack: AdventPack): string {
  const { advent } = pack;
  const { schedule, legal, rules } = advent;
  const tz = schedule.timezone;
  const lines: string[] = [];
  const out = (...parts: string[]) => lines.push(...parts);

  out(
    `# Правила акции «${advent.title}»`,
    "",
    "> **ТРЕБУЕТ УТВЕРЖДЕНИЯ ЮРИСТОМ ЗАКАЗЧИКА.** Черновик собран автоматически из данных пакета (`npm run quiz:rules`). Это не юридический документ: перед публикацией его проверяет и утверждает юрист заказчика, после чего эту пометку снимают.",
    "",
    "## 1. Организатор",
    "",
    `Организатор акции и оператор персональных данных: ${legal.operatorName}.`,
    ...(rules.organizerDetails ? [`Реквизиты: ${rules.organizerDetails}.`] : ["Реквизиты организатора: *заполнить (ИНН или ОГРН, адрес) — поле `rules.organizerDetails` пакета.*"]),
    ...(rules.contact ? [`Вопросы по акции и по персональным данным: ${rules.contact}.`] : ["Контакт для вопросов: *заполнить — поле `rules.contact` пакета.*"]),
    "",
    "## 2. Сроки",
    "",
    `- Акция проходит с ${date(dayUnlockAt(1, schedule), tz)} по ${date(dayUnlockAt(schedule.days, schedule), tz)}: всего ${schedule.days} ${plural(schedule.days, ["день", "дня", "дней"])}.`,
    `- Каждый день открывается в ${String(schedule.unlockHour).padStart(2, "0")}:00 (${tz}).`,
    `- Подведение итогов и выдача главного приза: с ${dateTime(schedule.finaleAt, tz)}.`,
    `- Выдача кодов и наград прекращается ${dateTime(schedule.claimEndsAt, tz)}.`,
    "",
    "## 3. Порядок участия",
    ""
  );
  if (rules.requiresPurchase) {
    out(
      "- Для участия **требуется покупка**: акция является стимулирующим мероприятием, и её условия подлежат согласованию юристом заказчика по ст. 9 Федерального закона «О рекламе» (38-ФЗ). *Опишите условие покупки (товар, сумма, срок, способ подтверждения).*"
    );
  } else {
    out("- Участие **бесплатное**: покупка товаров и услуг, взнос и иные платежи не требуются.");
  }
  out(
    `- Участник заходит на сайт акции, ежедневно открывает дверь текущего дня и проходит блоки дня: ${advent.days.some((day) => day.blocks.some((block) => block.type === "task")) ? "история, вопрос" : "история"}${advent.days.some((day) => day.blocks.some((block) => block.type === "luck")) ? `, ${LUCK_ACTION[advent.luck?.skin ?? "boxes"]} (удача)` : ""}${advent.days.some((day) => day.blocks.some((block) => block.type === "promo")) ? ", подарок дня" : ""}.`,
    `- ${catchUpText(pack)}`,
    `- Серия считается по дням, открытым в свой день.${advent.streak.freezes > 0 ? ` Допускается пропустить до ${advent.streak.freezes} ${plural(advent.streak.freezes, ["дня", "дней", "дней"])} без потери серии (заморозки).` : ""}${advent.streak.endowedDay ? " За участие в акции участнику засчитывается один подаренный день." : ""}`,
    "- Награды с кодом, остатком или погашением на кассе выдаются участникам, подтвердившим email по ссылке из письма; ссылка действует 30 минут и срабатывает один раз.",
    ""
  );
  if (advent.days.some((day) => day.blocks.some((block) => block.type === "luck"))) {
    out(
      `- «Удача»: выбор коробки, сектора или карточки носит игровой характер и на результат не влияет. Исход определяет сервер случайным образом среди призов, которые ещё остались, по заранее заданным весам; число призов с ограниченным остатком указано в разделе 4.${rules.requiresPurchase ? "" : " Участие в «удаче» бесплатное."}`,
      ""
    );
  }
  if (advent.streak.goals.length > 0) {
    out("Цели серии:", "");
    for (const goal of [...advent.streak.goals].sort((a, b) => a.opened - b.opened)) {
      const reward = advent.rewards.find((item) => item.id === goal.rewardId)!;
      out(`- открыть ${goal.opened} ${plural(goal.opened, ["дверь", "двери", "дверей"])} из ${schedule.days} — ${reward.label}`);
    }
    out("");
  }

  out("## 4. Призы и порядок выдачи", "", "| Награда | Вид | Стоимость | Остаток | Как получить |", "|---|---|---|---|---|");
  for (const reward of advent.rewards) {
    out(`| ${cell(reward.label)} | ${KIND[reward.kind]} | ${reward.valueRub !== undefined ? `${reward.valueRub} ₽` : "—"} | ${reward.stock !== undefined ? `${reward.stock} шт.` : "без ограничения"} | ${cell(redeemText(reward))} |`);
  }
  out("");
  const finals = advent.rewards.filter((reward) => reward.kind === "finalEntry");
  if (finals.length > 0) {
    out(
      `Главный приз (${finals.map((reward) => reward.label).join(", ")}): *заполнить — что именно разыгрывается, количество призов, как и когда определяется победитель (дата, способ, кто проводит), как победителя уведомят и как он получит приз (ст. 9 38-ФЗ требует указать количество призов, сроки и порядок их получения).*`,
      ""
    );
  }
  const rich = advent.rewards.filter((reward) => (reward.valueRub ?? 0) > NDFL_THRESHOLD_RUB);
  if (rich.length > 0) {
    out(`Стоимость призов (${rich.map((reward) => reward.label).join(", ")}) превышает ${String(NDFL_THRESHOLD_RUB).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽: с превышающей части удерживается налог на доходы физических лиц; порядок удержания и уведомления победителей — *согласовать с юристом и бухгалтерией заказчика*.`, "");
  }
  out("Выдача наград:", "", "- Награда выдаётся один раз за соответствующее условие (день, цель серии, возвращение после пропуска, удача).", "- Денежные эквиваленты вместо призов не выдаются; призы не подлежат обмену.", "");

  out("## 5. Сроки действия кодов", "");
  for (const reward of advent.rewards.filter((item) => item.codes !== undefined)) {
    out(`- ${reward.label}: ${validityText(reward)}.`);
  }
  if (!advent.rewards.some((item) => item.codes !== undefined)) out("Коды в акции не используются.");
  out("");

  out(
    "## 6. Персональные данные",
    "",
    `- Оператор: ${legal.operatorName}. Обрабатывается адрес электронной почты участника и данные о прохождении акции (открытые дни, ответы, выданные награды).`,
    "- Цели обработки: вход в акцию по ссылке из письма, сохранение прогресса, выдача наград и подведение итогов.",
    "- Согласие на обработку даётся отдельной отметкой при сохранении прогресса; без согласия письмо со ссылкой не отправляется.",
    ...(advent.reminders.channel === "email"
      ? [
          `- Напоминания по email (письма в ${advent.reminders.sendAtLocal} по времени ${tz}) — рассылка: их получают только участники, давшие **отдельное необязательное согласие на получение рекламных и информационных рассылок** от ${legal.operatorName} (ст. 18 38-ФЗ; отметка по умолчанию снята). Согласие не влияет на участие и выдачу наград и отзывается ссылкой «Отписаться» в любом письме или переключателем на сайте; согласие на обработку данных при этом сохраняется.`
        ]
      : []),
    "- Анонимный участник (без email) обезличен: идентификатором служит cookie устройства.",
    "- После окончания акции адрес email и согласия удаляются в срок, заданный настройкой `ADVENT_PII_RETENTION_DAYS` (по умолчанию 30 суток после окончания выдачи); обезличенная статистика прохождения остаётся.",
    "- Политика обработки персональных данных и текст согласия публикуются на сайте акции (`/privacy`) и утверждаются юристом заказчика.",
    "",
    "## 7. Прочее",
    "",
    "- Об изменении условий или досрочном прекращении акции организатор сообщает на сайте акции тем же способом, каким объявил её (ч. 2 ст. 9 38-ФЗ); *порядок изменения условий согласовать с юристом заказчика*.",
    "- Организатор вправе отказать в выдаче награды при злоупотреблениях (многократная регистрация, подделка кодов).",
    ""
  );
  return `${lines.join("\n")}`;
}
