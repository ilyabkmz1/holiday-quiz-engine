import { z } from "zod";

import { adventPackSchema, type AdventPack } from "@/config/pack";
import { isOverNdflThreshold } from "@/domain/advent";
import type { CheckReport } from "@/tools/pack-check";
import { MARKER, walkStrings } from "@/tools/pack-walk";

/**
 * Стоп-слова (138-ФЗ, 244-ФЗ): «лотерея», «ставка», «азарт». Ищем с начала слова, чтобы не ловить «поставка» и «заставка»;
 * регистр не важен.
 */
const STOP_WORDS = /(^|[^а-яё])(лотере|азарт|став[к])[а-яё]*/iu;

/**
 * Базовая проверка адвент-пакета (этап A1): схема с русскими ошибками, маркеры незаполненного, призы дороже порога НДФЛ,
 * стоп-слова по всем текстам пакета. Полный семантический линт (`world.path`, запас кодов, симуляция серии и целей,
 * finale < 24 ч, promo без кодов, teams без employees) появится на этапе A6.
 */
export function checkAdventPack(raw: unknown): CheckReport {
  const report: CheckReport = { errors: [], warnings: [], info: [] };

  const parsed = adventPackSchema.safeParse(raw, { error: z.locales.ru().localeError });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) report.errors.push(`схема: ${issue.path.join(".") || "(корень)"}: ${issue.message}`);
    return report;
  }
  const pack: AdventPack = parsed.data;
  const { advent } = pack;

  const markers: string[] = [];
  const stopWords: string[] = [];
  walkStrings(raw, "", (where, text) => {
    if (MARKER.test(text)) markers.push(where);
    const found = STOP_WORDS.exec(text);
    if (found) stopWords.push(`${where} («${found[2]}…»)`);
  });
  if (markers.length > 0) {
    report.errors.push(`незаполненные места (TODO/FIXME): ${markers.length}, например ${markers.slice(0, 5).join(", ")}`);
  }
  if (stopWords.length > 0) {
    report.warnings.push(
      `стоп-слова (лотерея, ставка, азарт; 138-ФЗ и 244-ФЗ): ${stopWords.length}, например ${stopWords.slice(0, 5).join(", ")}`
    );
  }

  for (const reward of advent.rewards.filter(isOverNdflThreshold)) {
    report.warnings.push(
      `награда ${reward.id}: ${reward.valueRub} ₽ дороже 4 000 ₽ — с приза удерживается НДФЛ 35%, предупредите заказчика`
    );
  }

  report.info.push(
    `дней: ${advent.days.length}, наград: ${advent.rewards.length}, героев: ${advent.heroes.length}, вид: ${advent.presentation}, профиль: ${pack.profile}`
  );
  report.info.push("полный семантический линт адвента (мир, коды, симуляция серии, юридические проверки) появится на этапе A6");
  return report;
}
