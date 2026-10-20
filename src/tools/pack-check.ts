import { existsSync } from "node:fs";
import path from "node:path";

import { loadWorld, worldIds } from "@/worlds/registry";
import { roomBindingReport, worldIssues } from "@/worlds/world";

import { packSchema, type TenantPack } from "@/config/pack";
import type { CampaignConfig, Task } from "@/config/schema";
import { hasLegalPlaceholder } from "@/config/legal";
import { correctPayload, wrongPayload } from "@/domain/solve";
import { SCORING, maxScore, resolveReward } from "@/domain/scoring";
import { InMemorySessionRepository } from "@/server/repositories/in-memory-session-repository";
import { RushService } from "@/server/services/rush-service";
import { SessionService } from "@/server/services/session-service";
import { checkAdventPack } from "@/tools/advent-check";
import { MARKER, walkStrings } from "@/tools/pack-walk";

export type CheckReport = {
  errors: string[];
  warnings: string[];
  info: string[];
};

function lengthWarnings(campaign: CampaignConfig, warn: (message: string) => void): void {
  const limit = (what: string, text: string, max: number) => {
    if (text.length > max) warn(`${what}: ${text.length} знаков при рекомендуемом максимуме ${max}, текст может не поместиться в вёрстку`);
  };
  limit("campaign.title", campaign.title, 60);
  limit("campaign.subtitle", campaign.subtitle, 80);
  limit("campaign.intro", campaign.intro, 400);
  limit("brand.name", campaign.brand.name, 40);
  for (const hero of campaign.heroes) {
    limit(`героя ${hero.id}: name`, hero.name, 16);
    limit(`героя ${hero.id}: role`, hero.role, 40);
  }
  for (const room of campaign.rooms) {
    limit(`зона ${room.id}: title`, room.title, 24);
    limit(`зона ${room.id}: eyebrow`, room.eyebrow, 40);
    limit(`зона ${room.id}: description`, room.description, 180);
    limit(`зона ${room.id}: ornament`, room.ornament, 30);
    for (const task of room.tasks) {
      limit(`задание ${task.id}: say`, task.say, 220);
      limit(`задание ${task.id}: thanks`, task.thanks, 200);
      limit(`задание ${task.id}: oops`, task.oops, 220);
      limit(`задание ${task.id}: tip`, task.tip, 260);
      limit(`задание ${task.id}: explanation`, task.explanation, 460);
      const variants = task.type === "phish" ? [] : task.type === "access" ? task.switches : task.type === "order" ? task.items : task.options;
      for (const variant of variants) limit(`задание ${task.id}, вариант ${variant.id}`, variant.title, 70);
    }
  }
  for (const item of campaign.rush.pool) limit(`рывок ${item.id}: prompt`, item.prompt, 110);
  for (const tier of campaign.rewardTiers) {
    limit(`уровень «${tier.title}»: title`, tier.title, 40);
    limit(`уровень «${tier.title}»: giftLabel`, tier.giftLabel, 90);
  }
}

export type Simulation = { perfectFast: number; perfectSlow: number; zero: number; topTier: string; zeroTier: string };

/** Прогон кампании через настоящие сервисы на in-memory репозитории: идеальный и нулевой проход. */
export async function simulate(campaign: CampaignConfig): Promise<Simulation> {
  const START = new Date("2026-12-24T12:00:00Z");

  /** Все комнаты (верно или неверно), затем рывок: `rushHits` верных заявок; `secondsPerTask` — время на каждое задание. */
  async function run(correct: boolean, secondsPerTask: number, rushHits: number) {
    let now = START;
    const clock = () => new Date(now);
    const repository = new InMemorySessionRepository();
    const sessions = new SessionService(repository, campaign, clock);
    const rush = new RushService(repository, sessions, campaign, clock, () => 0.999999);
    const { session } = await sessions.create();
    for (const room of campaign.rooms) {
      await sessions.enterRoom(session.id, room.id);
      for (const task of room.tasks as Task[]) {
        await sessions.roomTask(session.id, room.id);
        now = new Date(now.getTime() + secondsPerTask * 1000);
        await sessions.answerTask(session.id, task.id, correct ? correctPayload(task) : wrongPayload(task));
      }
    }
    let state = await rush.start(session.id);
    // Рывок выдаёт заявки по одной (`current`), поэтому отвечаем по очереди.
    for (let hit = 0; hit < rushHits && state.rush.current; hit += 1) {
      const item = campaign.rush.pool.find((candidate) => candidate.id === state.rush.current!.itemId)!;
      const result = await rush.answer(session.id, item.id, item.serviceId);
      state = { ...state, rush: result.rush };
    }
    await rush.finish(session.id);
    return sessions.complete(session.id);
  }

  const fast = await run(true, 0, SCORING.rushPlannedHits);
  const slow = await run(true, SCORING.speedWindowSeconds, SCORING.rushPlannedHits);
  const zero = await run(false, 0, 0);
  return {
    perfectFast: fast.score,
    perfectSlow: slow.score,
    zero: zero.score,
    topTier: resolveReward(fast.score, campaign.rewardTiers).title,
    zeroTier: resolveReward(zero.score, campaign.rewardTiers).title
  };
}

/** Миры, собранные в образ (манифест `worlds/index.ts`). */
export function knownWorlds(): string[] {
  return worldIds();
}

/** Сырой пакет с `experience: "advent"`. Остальное (включая отсутствие поля) проверяется как квиз. */
function isAdventRaw(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && (raw as { experience?: unknown }).experience === "advent";
}

export type CheckOptions = {
  /** Корень проекта: от него берутся `public/` и `worlds/`. */
  root?: string;
  now?: Date;
  /** Адвент: каталог пакета (по умолчанию `<root>/tenants/<slug>`): в нём `codes/<id>.csv` и `rules.md`. */
  tenantDir?: string;
  /** Адвент: ожидаемое число участников (важнее поля пакета). */
  expectedParticipants?: number;
};

/**
 * Проверка пакета арендатора: схема, маркеры незаполненного, семантический линт и симуляция.
 * Ошибки блокируют запуск, предупреждения — на усмотрение человека.
 */
export async function checkPack(raw: unknown, options: CheckOptions = {}): Promise<CheckReport> {
  const root = options.root ?? process.cwd();
  const now = options.now ?? new Date();
  const report: CheckReport = { errors: [], warnings: [], info: [] };

  // Адвент-пакет проверяется отдельной веткой (`advent-check.ts`); квиз — как раньше, с теми же текстами ошибок.
  if (isAdventRaw(raw)) return checkAdventPack(raw, options);

  const parsed = packSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) report.errors.push(`схема: ${issue.path.join(".") || "(корень)"}: ${issue.message}`);
    return report;
  }
  const pack: TenantPack = parsed.data;
  const { campaign } = pack;

  const markers: string[] = [];
  walkStrings(raw, "", (where, text) => {
    if (MARKER.test(text)) markers.push(where);
  });
  if (markers.length > 0) {
    report.errors.push(`незаполненные места (TODO/FIXME): ${markers.length}, например ${markers.slice(0, 5).join(", ")}`);
  }

  lengthWarnings(campaign, (message) => report.warnings.push(`длина: ${message}`));

  for (const [what, webPath] of [["brand.logo", campaign.brand.logo], ["brand.ogBackground", campaign.brand.ogBackground]] as const) {
    if (webPath && !existsSync(path.join(root, "public", ...webPath.split("/").filter(Boolean)))) {
      report.errors.push(`${what}: файл ${webPath} не найден в public/`);
    }
  }

  const worlds = knownWorlds();
  if (!worlds.includes(pack.worldId)) {
    report.errors.push(`worldId «${pack.worldId}»: такого мира нет (доступны: ${worlds.join(", ")})`);
  } else {
    const world = loadWorld(pack.worldId);
    for (const issue of worldIssues(world)) report.errors.push(`мир ${world.id}: ${issue}`);
    for (const [what, webPath] of [["арт мира", world.art.src], ...world.spots.flatMap((spot) => (spot.art ? [[`арт точки ${spot.id}`, spot.art] as const] : []))] as const) {
      if (!existsSync(path.join(root, "public", ...webPath.split("/").filter(Boolean)))) report.errors.push(`мир ${world.id}: ${what}: файл ${webPath} не найден в public/`);
    }
    const binding = roomBindingReport(world, campaign.rooms, campaign.mode);
    report.errors.push(...binding.errors);
    report.warnings.push(...binding.warnings);
  }
  const rooms = campaign.rooms;
  for (let first = 0; first < rooms.length; first += 1) {
    for (let second = first + 1; second < rooms.length; second += 1) {
      const distance = Math.hypot(rooms[first].map.x - rooms[second].map.x, rooms[first].map.y - rooms[second].map.y);
      if (distance < 6) report.warnings.push(`карта: зоны ${rooms[first].id} и ${rooms[second].id} слишком близко (${distance.toFixed(1)}% иллюстрации), кнопки перекроются`);
    }
  }

  if (hasLegalPlaceholder(campaign.legal)) {
    report.warnings.push("legal: в юридических текстах маркер «на согласовании юриста» — в production запуск запрещён");
  }
  if (new Date(campaign.verificationEndsAt) < now) {
    report.warnings.push(`даты: кампания закончилась ${campaign.verificationEndsAt}`);
  }
  const says = campaign.rooms.flatMap((room) => room.tasks.map((task) => task.say.trim().toLowerCase()));
  if (new Set(says).size !== says.length) report.warnings.push("задания: есть повторяющиеся формулировки say");
  const types = new Set(campaign.rooms.flatMap((room) => room.tasks.map((task) => task.type)));
  if (types.size === 1) report.warnings.push(`задания: все одного типа (${[...types][0]}), игроку будет скучно`);

  const taskCounts = campaign.rooms.map((room) => room.tasks.length);
  const max = maxScore(taskCounts);
  report.info.push(`зон: ${rooms.length}, заданий: ${taskCounts.reduce((sum, count) => sum + count, 0)}, героев: ${campaign.heroes.length}, пул рывка: ${campaign.rush.pool.length}`);
  report.info.push(`максимум очков по формуле: ${max}; пороги: ${campaign.rewardTiers.map((tier) => `${tier.title} от ${tier.minScore}`).join(", ")}`);

  try {
    const result = await simulate(campaign);
    report.info.push(`симуляция: идеальный проход ${result.perfectFast} (медленный ${result.perfectSlow}), нулевой ${result.zero}`);
    if (result.perfectFast !== max) {
      report.errors.push(`симуляция: идеальный проход дал ${result.perfectFast}, а формула maxScore — ${max}: расхождение в подсчёте`);
    }
    const top = campaign.rewardTiers[campaign.rewardTiers.length - 1];
    if (result.topTier !== top.title) {
      report.errors.push(`уровни: идеальный проход (${result.perfectFast}) не достигает высшего уровня «${top.title}» (от ${top.minScore})`);
    }
    if (result.perfectSlow < top.minScore) {
      report.warnings.push(`уровни: высший уровень «${top.title}» недостижим без бонуса скорости (медленный идеальный проход даёт ${result.perfectSlow} < ${top.minScore})`);
    }
    const bottom = campaign.rewardTiers[0];
    if (result.zeroTier !== bottom.title) {
      report.errors.push(`уровни: нулевой проход (${result.zero} очков) получает «${result.zeroTier}», а не нижний «${bottom.title}»`);
    }
  } catch (error) {
    report.errors.push(`симуляция упала: ${error instanceof Error ? error.message : String(error)}`);
  }
  return report;
}
