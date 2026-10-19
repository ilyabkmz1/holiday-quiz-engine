import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { adventPackSchema, type AdventPack } from "@/config/pack";
import type { AdventConfig } from "@/config/advent-schema";
import { hasLegalPlaceholder } from "@/config/legal";
import { dayUnlockAt, isOverNdflThreshold } from "@/domain/advent";
import { simulateAdvent } from "@/tools/advent-sim";
import type { CheckReport } from "@/tools/pack-check";
import { MARKER, walkStrings } from "@/tools/pack-walk";
import { loadWorld } from "@/worlds/registry";
import { worldIds } from "@/worlds/registry";
import { worldIssues } from "@/worlds/world";

/**
 * Стоп-слова (138-ФЗ, 244-ФЗ): «лотерея», «ставка», «азарт». Ищем с начала слова, чтобы не ловить «поставка» и «заставка»;
 * регистр не важен.
 */
const STOP_WORDS = /(^|[^а-яё])(лотере|азарт|став[к])[а-яё]*/iu;

/**
 * Алкоголь и табак (38-ФЗ «О рекламе», 15-ФЗ): их нельзя делать призом и героем рекламной акции. «Вино» и «пиво» ищем только в
 * своих формах: «вина» не ищем (это и «вина» как вина, и «виноват»), «виноград» не ловится; остальное — с начала слова.
 */
const ALCOHOL_TOBACCO = /(^|[^а-яё])(алкогол|водк|виски|коньяк|сигарет|таба[кч]|вейп|кальян|пив(?:о|а|у|е|ом)(?![а-яё])|вин(?:о|ом|ный|ная|ные|ного)(?![а-яё]))[а-яё]*/iu;

/** Локальные адреса и тестовые зоны: демо-пакет с таким `hosts` на боевой адрес не похож. */
const LOCAL_HOST = /(^|\.)(localhost|test|example|invalid)(:\d+)?$/;

export type AdventCheckOptions = {
  /** Корень проекта: от него берутся `public/` и `worlds/`. */
  root?: string;
  now?: Date;
  /** Каталог пакета (`tenants/<slug>`): в нём ищем `codes/<id>.csv` и `rules.md`. */
  tenantDir?: string;
  /** Ожидаемое число участников; важнее поля пакета `expectedParticipants`. */
  expectedParticipants?: number;
};

const limit = (what: string, text: string, max: number, warn: (message: string) => void) => {
  if (text.length > max) warn(`длина: ${what}: ${text.length} знаков при рекомендуемом максимуме ${max}, текст может не поместиться в вёрстку`);
};

/** Сколько раз награда может выпасть одному участнику (верхняя оценка): день, подарок дня, удача, цели, возвращение, старт. */
function maxIssuancesPerParticipant(advent: AdventConfig, rewardId: string): number {
  let total = 0;
  for (const day of advent.days) {
    // Награда за закрытие дня и подарок дня — одна выдача на день.
    const daily = day.rewardId === rewardId || day.blocks.some((block) => block.type === "promo" && block.rewardId === rewardId);
    const luck = day.blocks.some((block) => block.type === "luck" && block.pool.some((item) => item.rewardId === rewardId));
    total += (daily ? 1 : 0) + (luck ? 1 : 0);
  }
  total += advent.streak.goals.filter((goal) => goal.rewardId === rewardId).length;
  if (advent.streak.comebackBonusRewardId === rewardId) total += 1;
  if (advent.streak.endowedRewardId === rewardId) total += 1;
  return total;
}

/** Уникальные коды из CSV (столбец `code` или первый столбец; шапка и пустые строки пропускаются). */
function countCodes(file: string): number {
  const codes = new Set<string>();
  for (const [index, line] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
    const code = line.split(/[;,]/)[0]?.trim().replace(/^"|"$/g, "").toUpperCase();
    if (!code || (index === 0 && code === "CODE")) continue;
    codes.add(code);
  }
  return codes.size;
}

function textLimits(advent: AdventConfig, warn: (message: string) => void): void {
  limit("advent.title", advent.title, 60, warn);
  limit("advent.subtitle", advent.subtitle, 80, warn);
  limit("advent.intro", advent.intro, 400, warn);
  for (const day of advent.days) {
    limit(`день ${day.n}: title`, day.title, 40, warn);
    limit(`день ${day.n}: teaser`, day.teaser, 110, warn);
    for (const line of day.chapter.lines) limit(`день ${day.n}: глава`, line, 220, warn);
    for (const block of day.blocks) {
      if (block.type === "story") for (const line of block.lines) limit(`день ${day.n}: история`, line, 220, warn);
      if (block.type === "task") {
        limit(`задание ${block.task.id}: say`, block.task.say, 220, warn);
        limit(`задание ${block.task.id}: explanation`, block.task.explanation, 460, warn);
      }
    }
  }
  for (const reward of advent.rewards) {
    limit(`награда ${reward.id}: label`, reward.label, 60, warn);
    limit(`награда ${reward.id}: description`, reward.description, 160, warn);
  }
}

/**
 * Полная проверка адвент-пакета: схема с русскими ошибками, маркеры незаполненного, юридические проверки (стоп-слова, алкоголь
 * и табак, НДФЛ, правила при покупке, демо в боевом пакете), семантика наград (promo без кодов, online без ссылки, запас кодов
 * из списков), расписание (финал не раньше чем через 24 часа после последнего дня), мир и точки дней, рейтинг команд и симуляция
 * трёх игроков через доменные сервисы.
 */
export async function checkAdventPack(raw: unknown, options: AdventCheckOptions = {}): Promise<CheckReport> {
  const root = options.root ?? process.cwd();
  const now = options.now ?? new Date();
  const report: CheckReport = { errors: [], warnings: [], info: [] };

  const parsed = adventPackSchema.safeParse(raw, { error: z.locales.ru().localeError });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) report.errors.push(`схема: ${issue.path.join(".") || "(корень)"}: ${issue.message}`);
    return report;
  }
  const pack: AdventPack = parsed.data;
  const { advent } = pack;
  const tenantDir = options.tenantDir ?? path.join(root, "tenants", pack.tenant);

  // Тексты: маркеры незаполненного, стоп-слова и запрещённые к рекламе товары.
  const markers: string[] = [];
  const stopWords: string[] = [];
  const restricted: string[] = [];
  walkStrings(raw, "", (where, text) => {
    if (MARKER.test(text)) markers.push(where);
    const stop = STOP_WORDS.exec(text);
    if (stop) stopWords.push(`${where} («${stop[2]}…»)`);
    const forbidden = ALCOHOL_TOBACCO.exec(text);
    if (forbidden) restricted.push(`${where} («${forbidden[2]}…»)`);
  });
  if (markers.length > 0) {
    report.errors.push(`незаполненные места (TODO/FIXME): ${markers.length}, например ${markers.slice(0, 5).join(", ")}`);
  }
  if (stopWords.length > 0) {
    report.warnings.push(`стоп-слова (лотерея, ставка, азарт; 138-ФЗ и 244-ФЗ): ${stopWords.length}, например ${stopWords.slice(0, 5).join(", ")}`);
  }
  if (restricted.length > 0) {
    report.errors.push(`алкоголь и табак нельзя делать призом и темой акции (38-ФЗ, 15-ФЗ): ${restricted.length}, например ${restricted.slice(0, 5).join(", ")}`);
  }
  textLimits(advent, (message) => report.warnings.push(message));

  // Юридическое.
  for (const reward of advent.rewards.filter(isOverNdflThreshold)) {
    report.warnings.push(`награда ${reward.id}: ${reward.valueRub} ₽ дороже 4 000 ₽ — с приза удерживается НДФЛ 35%, предупредите заказчика`);
  }
  if (hasLegalPlaceholder(advent.legal)) {
    report.warnings.push("legal: в юридических текстах маркер «на согласовании юриста» — в production запуск запрещён");
  }
  if (pack.demo && pack.hosts.some((host) => !LOCAL_HOST.test(host))) {
    report.warnings.push(`demo: true в пакете с боевым адресом (${pack.hosts.filter((host) => !LOCAL_HOST.test(host)).join(", ")}): в production такой пакет принимает ?asOf= и показывает любой день любому посетителю`);
  }
  if (advent.rules.requiresPurchase) {
    const rulesPath = path.join(tenantDir, "rules.md");
    if (!existsSync(rulesPath)) {
      report.errors.push("rules.requiresPurchase: для участия нужна покупка, а это стимулирующее мероприятие: по ст. 9 38-ФЗ обязательны правила (npm run quiz:rules, затем утверждение юристом), файла rules.md нет");
    } else if (/ТРЕБУЕТ УТВЕРЖДЕНИЯ/.test(readFileSync(rulesPath, "utf8"))) {
      report.warnings.push("rules.md: правила ещё не утверждены юристом заказчика (в файле стоит пометка «требует утверждения»); перед запуском её снимают");
    }
  }

  // Награды.
  for (const reward of advent.rewards) {
    if (reward.kind === "promo" && reward.codes === undefined) {
      report.errors.push(`награда ${reward.id}: промокод (kind: promo) без codes — выдавать нечего; задайте static, list или generated`);
    }
    if ((reward.redeem === "online" || reward.redeem === "both") && !reward.url) {
      report.errors.push(`награда ${reward.id}: погашение ${reward.redeem} без url — участнику некуда идти`);
    }
    if (reward.kind === "promo" && reward.redeem === "none") {
      report.warnings.push(`награда ${reward.id}: промокод с redeem: none — как его применять, участник не узнает`);
    }
    if (reward.validDays === undefined && reward.codes !== undefined && reward.kind !== "finalEntry") {
      report.warnings.push(`награда ${reward.id}: у кода нет срока действия (validDays) — он будет действовать бессрочно`);
    }
  }

  // Запас кодов из списков против ожидаемого числа участников.
  const expected = options.expectedParticipants ?? pack.expectedParticipants;
  for (const reward of advent.rewards) {
    if (!reward.codes || !("list" in reward.codes)) continue;
    const file = path.join(tenantDir, ...reward.codes.list.split("/"));
    const perPlayer = maxIssuancesPerParticipant(advent, reward.id);
    if (!existsSync(file)) {
      report.warnings.push(`награда ${reward.id}: список кодов ${reward.codes.list} не найден в пакете; коды загружают в админке (POST /api/admin/advent/codes), запас сверьте по отчёту импорта`);
      continue;
    }
    const available = countCodes(file);
    if (expected === undefined) {
      report.warnings.push(`награда ${reward.id}: в списке ${available} кодов, а ожидаемое число участников не задано (expectedParticipants в пакете или --participants): запас не проверить`);
      continue;
    }
    const need = Math.min(expected * Math.max(perPlayer, 1), reward.stock ?? Number.POSITIVE_INFINITY);
    report.info.push(`награда ${reward.id}: кодов ${available}, нужно до ${need} (${expected} участников × до ${perPlayer} выдач)`);
    if (available < need) {
      report.errors.push(`награда ${reward.id}: кодов ${available}, а нужно до ${need} (${expected} участников × до ${perPlayer} выдач${reward.stock !== undefined ? `, остаток ${reward.stock}` : ""}): пул опустеет раньше конца акции`);
    }
  }

  // Расписание.
  const lastOpen = dayUnlockAt(advent.schedule.days, advent.schedule).getTime();
  const gapHours = (new Date(advent.schedule.finaleAt).getTime() - lastOpen) / 3_600_000;
  if (gapHours < 24) {
    report.warnings.push(`расписание: финал наступает через ${gapHours.toFixed(1)} ч после открытия последнего дня, меньше 24 ч: игрок не успеет его пройти`);
  }
  if (new Date(advent.schedule.claimEndsAt) < now) {
    report.warnings.push(`даты: выдача кодов закончилась ${advent.schedule.claimEndsAt}`);
  }

  // Аудитория.
  if (advent.audience.leaderboard === "teams" && advent.audience.kind !== "employees") {
    report.errors.push("audience: рейтинг по командам (leaderboard: teams) только для сотрудников (kind: employees): у клиентов команд нет");
  }

  // Мир и точки дней.
  const worlds = worldIds();
  if (!worlds.includes(pack.worldId)) {
    report.errors.push(`worldId «${pack.worldId}»: такого мира нет (доступны: ${worlds.join(", ")})`);
  } else {
    const world = loadWorld(pack.worldId);
    for (const issue of worldIssues(world)) report.errors.push(`мир ${world.id}: ${issue}`);
    const spots = new Set(world.spots.map((spot) => spot.id));
    for (const day of advent.days) {
      if (day.spotId && !spots.has(day.spotId)) report.errors.push(`день ${day.n}: точки «${day.spotId}» нет в мире ${world.id} (есть: ${[...spots].join(", ")})`);
    }
    if (advent.presentation === "world") {
      // Порядок обхода (`path`) мир получит на этапе A4; пока опираемся на него, если он есть, иначе нужны явные `spotId`.
      const worldPath = (world as { path?: string[] }).path;
      if (worldPath) {
        for (const spotId of worldPath) if (!spots.has(spotId)) report.errors.push(`мир ${world.id}: в path точки «${spotId}» нет среди spots`);
      } else if (advent.days.some((day) => !day.spotId)) {
        report.warnings.push(`presentation: world, а у мира ${world.id} нет path: задайте spotId каждому дню (сейчас без него дни показываются календарём)`);
      }
    }
  }
  for (const [what, webPath] of [["brand.logo", advent.brand.logo], ["brand.ogBackground", advent.brand.ogBackground]] as const) {
    if (webPath && !existsSync(path.join(root, "public", ...webPath.split("/").filter(Boolean)))) {
      report.errors.push(`${what}: файл ${webPath} не найден в public/`);
    }
  }

  report.info.push(
    `дней: ${advent.days.length}, наград: ${advent.rewards.length}, героев: ${advent.heroes.length}, вид: ${advent.presentation}, профиль: ${pack.profile}`
  );

  // Симуляция трёх игроков.
  try {
    const sim = await simulateAdvent(advent);
    const days = advent.schedule.days;
    const line = (name: string, run: typeof sim.perfect) =>
      `${name}: открыто ${run.opened} из ${days}, пройдено ${run.completed}, лучшая серия ${run.bestStreak}, цели ${run.goalsReached} из ${run.goalsTotal}, выдач ${run.grants}`;
    report.info.push(`симуляция, ${line("идеальный игрок", sim.perfect)}`);
    report.info.push(`симуляция, ${line("игрок с пропусками (каждый третий день)", sim.skipping)}`);
    report.info.push(`симуляция, ${line("догоняющий (пришёл в последний день)", sim.catchUp)}`);
    for (const [name, run] of Object.entries({ "идеальный игрок": sim.perfect, "игрок с пропусками": sim.skipping, "догоняющий": sim.catchUp })) {
      for (const error of run.errors) report.errors.push(`симуляция, ${name}: ${error}`);
    }
    if (sim.perfect.errors.length === 0) {
      if (sim.perfect.opened !== days || sim.perfect.completed !== days) {
        report.errors.push(`симуляция: идеальный игрок открыл ${sim.perfect.opened} и прошёл ${sim.perfect.completed} дней из ${days}`);
      }
      if (sim.perfect.bestStreak !== days) report.errors.push(`симуляция: идеальный игрок собрал серию ${sim.perfect.bestStreak}, а дней ${days}`);
      if (sim.perfect.goalsReached !== sim.perfect.goalsTotal) {
        report.errors.push(`симуляция: идеальный игрок достиг целей ${sim.perfect.goalsReached} из ${sim.perfect.goalsTotal}: главный приз недостижим`);
      }
      if (sim.perfect.grantsWithoutCode > 0) {
        const pending = advent.rewards.some((reward) => reward.codes !== undefined && "list" in reward.codes);
        if (pending) report.info.push(`симуляция: у ${sim.perfect.grantsWithoutCode} выдач нет кода (в симуляции списки кодов не загружены, награды без кодов выдаются как есть)`);
      }
    }
    if (sim.catchUp.errors.length === 0 && sim.catchUp.goalsReached < sim.catchUp.goalsTotal) {
      report.info.push(`симуляция: догоняющий игрок (правило догоняния ${JSON.stringify(advent.schedule.catchUp)}) достигает целей ${sim.catchUp.goalsReached} из ${sim.catchUp.goalsTotal}`);
    }
  } catch (error) {
    report.errors.push(`симуляция упала: ${error instanceof Error ? error.message : String(error)}`);
  }
  return report;
}
