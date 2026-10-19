import { describe, expect, it } from "vitest";

import { adventPackSchema } from "@/config/pack";
import { buildRules } from "@/tools/advent-rules";

import { adventPackFixture } from "../fixtures/advent";

const rules = (patch: (draft: any) => void = () => undefined) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const draft = adventPackFixture();
  patch(draft);
  return buildRules(adventPackSchema.parse(draft));
};

describe("quiz:rules: правила акции из пакета", () => {
  const text = rules();

  it("начинается с пометки «требует утверждения юристом заказчика»", () => {
    expect(text).toMatch(/^# Правила акции «Адвент кофейни «Зерно»»\n\n> \*\*ТРЕБУЕТ УТВЕРЖДЕНИЯ ЮРИСТОМ ЗАКАЗЧИКА\.\*\*/);
  });

  it("все разделы на месте", () => {
    for (const heading of ["## 1. Организатор", "## 2. Сроки", "## 3. Порядок участия", "## 4. Призы и порядок выдачи", "## 5. Сроки действия кодов", "## 6. Персональные данные", "## 7. Прочее"]) {
      expect(text).toContain(heading);
    }
  });

  it("организатор и сроки взяты из пакета", () => {
    expect(text).toContain("ИП Зернов А. А. (демо)");
    expect(text).toContain("с 20 декабря 2026 г. по 31 декабря 2026 г.: всего 12 дней");
    expect(text).toContain("Каждый день открывается в 00:00 (Europe/Moscow)");
    expect(text).toMatch(/Подведение итогов и выдача главного приза: с 1 января 2027 г\., 00:00/);
    expect(text).toMatch(/прекращается 14 января 2027 г\., 23:59/);
  });

  it("порядок участия: бесплатно, догоняние, заморозки, удача, цели", () => {
    expect(text).toContain("Участие **бесплатное**");
    expect(text).toContain("в течение 1 дня после его дня");
    expect(text).toContain("награда дня не выдаётся");
    expect(text).toContain("до 1 дня без потери серии");
    expect(text).toContain("«Удача»");
    expect(text).toContain("открыть 4 двери из 12 — Десерт за серию");
    expect(text).toContain("открыть 8 дверей из 12 — Участие в финальном розыгрыше");
  });

  it("таблица призов: вид, остаток, способ получения; сроки действия кодов", () => {
    expect(text).toContain("| Напиток или десерт дня | подарок | — | без ограничения | на кассе:");
    expect(text).toContain("| Кофе в подарок | подарок | — | 30 шт. |");
    expect(text).toContain("| Участие в финальном розыгрыше | участие в финальном розыгрыше |");
    expect(text).toContain("- Напиток или десерт дня: 2 дня с момента выдачи кода.");
    expect(text).toContain("- Десерт за серию: 3 дня с момента выдачи кода.");
  });

  it("персональные данные: оператор, отдельное согласие на напоминания, удаление", () => {
    expect(text).toContain("Оператор: ИП Зернов А. А. (демо)");
    expect(text).toContain("отдельной необязательной отметкой");
    expect(text).toContain("письма в 08:30 по времени Europe/Moscow");
    expect(text).toContain("ADVENT_PII_RETENTION_DAYS");
  });

  it("реквизиты и контакт из пакета; без них — места для заполнения", () => {
    expect(text).toContain("*заполнить (ИНН или ОГРН, адрес)");
    const filled = rules((draft) => (draft.advent.rules = { organizerDetails: "ИНН 7700000000, г. Москва", contact: "privacy@zerno.example" }));
    expect(filled).toContain("Реквизиты: ИНН 7700000000, г. Москва.");
    expect(filled).toContain("Вопросы по акции и по персональным данным: privacy@zerno.example.");
    expect(filled).not.toContain("*заполнить");
  });

  it("покупка для участия: вместо «бесплатное» — условие и ст. 9 38-ФЗ", () => {
    const purchase = rules((draft) => (draft.advent.rules = { requiresPurchase: true }));
    expect(purchase).toContain("**требуется покупка**");
    expect(purchase).toContain("ст. 9 Федерального закона «О рекламе» (38-ФЗ)");
    expect(purchase).not.toContain("Участие **бесплатное**");
  });

  it("приз дороже 4 000 ₽ — абзац про НДФЛ; иначе его нет", () => {
    expect(text).not.toContain("налог на доходы");
    const rich = rules((draft) => (draft.advent.rewards[3].valueRub = 5000));
    expect(rich).toContain("превышает 4 000 ₽");
    expect(rich).toContain("Печенье к кофе");
    expect(rich).toContain("налог на доходы физических лиц");
  });

  it("догоняние и без удачи: тексты меняются вместе с пакетом", () => {
    const none = rules((draft) => (draft.advent.schedule.catchUp = "none"));
    expect(none).toContain("Пропущенный день открыть нельзя.");
    const all = rules((draft) => { draft.advent.schedule.catchUp = "all"; draft.advent.schedule.rewardOnlyOnDay = false; });
    expect(all).toContain("в любой момент до завершения акции");
    expect(all).toContain("Награда дня за день, открытый с опозданием, выдаётся.");
    expect(rules((draft) => draft.advent.rewards.forEach((reward: { codes?: unknown }) => (reward.codes = undefined)))).toContain("Коды в акции не используются.");
  });

  it("сам текст правил не содержит стоп-слов и алкоголя", () => {
    expect(text).not.toMatch(/лотере|азарт|ставк/i);
    expect(text).not.toMatch(/алкогол|табак|сигарет/i);
  });
});
