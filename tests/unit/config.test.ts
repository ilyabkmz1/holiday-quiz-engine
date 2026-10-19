import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { campaign } from "@tenants/demo-office/campaign";
import { LEGAL_PLACEHOLDER, hasLegalPlaceholder } from "@/config/legal";
import { maxScore } from "@/domain/scoring";
import { REVEALING_ID_PATTERN, campaignSchema } from "@/config/schema";

type Mutable = ReturnType<typeof structuredClone<typeof campaign>>;

/** Копия настоящей кампании с одной правкой: проверяем, что схема ловит именно её. */
function invalidWith(edit: (draft: Mutable) => void): boolean {
  const draft = structuredClone(campaign);
  edit(draft);
  return !campaignSchema.safeParse(draft).success;
}

/** Коды ошибок схемы для правки: так видно, что граница сработала именно на превышении, а не на побочной ошибке. */
function issueCodes(edit: (draft: Mutable) => void): string[] {
  const draft = structuredClone(campaign);
  edit(draft);
  const result = campaignSchema.safeParse(draft);
  return result.success ? [] : result.error.issues.filter((issue) => issue.code === "too_big").map((issue) => issue.path.join("."));
}

const task = (draft: Mutable, id: string) => draft.rooms.flatMap((room) => room.tasks).find((candidate) => candidate.id === id)!;

describe("campaignSchema", () => {
  it("accepts the shipped campaign unchanged", () => {
    expect(campaignSchema.parse(campaign)).toEqual(campaign);
  });

  it("порядок полей и ошибок не зависит от выноса campaignCoreSchema", () => {
    expect(Object.keys(campaignSchema.parse(campaign))).toEqual([
      "slug", "mode", "title", "subtitle", "intro", "startsAt", "claimEndsAt", "verificationEndsAt", "scene",
      "brand", "story", "copy", "legal", "heroes", "prologue", "rooms", "rush", "rewardTiers"
    ]);
    const draft: Record<string, unknown> = structuredClone(campaign);
    for (const key of ["slug", "startsAt", "brand", "heroes", "rooms"]) delete draft[key];
    const result = campaignSchema.safeParse(draft);
    expect(result.success ? [] : result.error.issues.map((item) => item.path.join("."))).toEqual(["slug", "startsAt", "brand", "heroes", "rooms"]);
  });

  it("держит количества в диапазонах: зоны 3–6, задания 2–4, уровни 2–5, герои 1–8", () => {
    // Нижние границы: на единицу меньше допустимого — ошибка.
    expect(invalidWith((draft) => { draft.rooms.length = 2; draft.rush.services.length = 2; })).toBe(true);
    expect(invalidWith((draft) => { draft.rooms[0].tasks.length = 1; })).toBe(true);
    expect(invalidWith((draft) => { draft.rewardTiers.length = 1; })).toBe(true);
    expect(invalidWith((draft) => { draft.heroes.length = 0; })).toBe(true);
    // Верхние границы: заданий (4), героев (8), зон (6) и уровней призов (5).
    expect(invalidWith((draft) => { draft.rooms[0].tasks.push({ ...draft.rooms[0].tasks[0], id: "extra-1" }, { ...draft.rooms[0].tasks[0], id: "extra-2" }); })).toBe(true);
    expect(issueCodes((draft) => { while (draft.heroes.length < 9) draft.heroes.push({ ...draft.heroes[0], id: `extra-hero-${draft.heroes.length}` }); })).toContain("heroes");
    expect(issueCodes((draft) => {
      while (draft.rooms.length < 7) draft.rooms.push({ ...structuredClone(draft.rooms[0]), id: `extra-room-${draft.rooms.length}`, tasks: draft.rooms[0].tasks.map((task, index) => ({ ...task, id: `extra-${draft.rooms.length}-${index}` })) });
    })).toContain("rooms");
    expect(issueCodes((draft) => { while (draft.rewardTiers.length < 6) draft.rewardTiers.push({ ...draft.rewardTiers.at(-1)!, minScore: 9000 + draft.rewardTiers.length }); })).toContain("rewardTiers");
  });

  it("принимает урезанную кампанию: 3 зоны по 2 задания, 2 уровня, сервисы рывка совпадают с зонами", () => {
    const small = structuredClone(campaign);
    small.rooms = small.rooms.slice(0, 3).map((room) => ({ ...room, tasks: room.tasks.slice(0, 2) }));
    const roomIds = new Set(small.rooms.map((room) => room.id));
    small.rush.services = small.rush.services.filter((service) => roomIds.has(service.id));
    small.rush.pool = small.rush.pool.filter((item) => roomIds.has(item.serviceId));
    small.rewardTiers = small.rewardTiers.slice(0, 2);
    small.heroes = small.heroes.slice(0, 6);
    // Пул рывка после фильтра обязан остаться не короче 16 заявок: добираем копиями с новыми id.
    let copy = 0;
    while (small.rush.pool.length < 16) {
      const source = small.rush.pool[copy % small.rush.pool.length];
      small.rush.pool.push({ ...source, id: `${source.id}-copy${copy}` });
      copy += 1;
    }
    small.rush.pool = small.rush.pool.map((item, index) => ({ ...item, security: index < 3 }));
    // Задания с heroId вне оставленных героев остаются валидными: герои не урезаны.
    const result = campaignSchema.safeParse(small);
    if (!result.success) throw new Error(JSON.stringify(result.error.issues));
    expect(result.data.rooms).toHaveLength(3);
  });

  it("связывает сервисы рывка с id зон", () => {
    expect(invalidWith((draft) => { draft.rush.services[0].id = "ghost-service"; })).toBe(true);
    expect(invalidWith((draft) => { draft.rush.services.pop(); })).toBe(true);
  });

  it("отвергает неизвестные имена иконок вместо тихого фолбэка", () => {
    expect(invalidWith((draft) => { draft.rooms[0].icon = "no-such-icon"; })).toBe(true);
    expect(invalidWith((draft) => { draft.rush.services[0].icon = "no-such-icon"; })).toBe(true);
    expect(invalidWith((draft) => {
      const pick = task(draft, "mail-invite");
      if (pick.type === "pick") pick.options[0].icon = "fallback";
    })).toBe(true);
  });

  it("пороги уровней задаются в процентах от максимума и переводятся в очки", () => {
    const draft = structuredClone(campaign);
    draft.rewardTiers = [
      { minScore: 0, title: "A", description: "", giftLabel: "a" },
      { minPercent: 50, title: "B", description: "", giftLabel: "b" },
      { minPercent: 80, title: "C", description: "", giftLabel: "c" }
    ] as typeof draft.rewardTiers;
    const parsed = campaignSchema.parse(draft);
    const max = maxScore(parsed.rooms.map((room) => room.tasks.length));
    expect(parsed.rewardTiers.map((tier) => tier.minScore)).toEqual([0, Math.round(max * 0.5), Math.round(max * 0.8)]);
  });

  it("требует у уровня minScore или minPercent и ловит их рассогласование", () => {
    expect(invalidWith((draft) => { Reflect.deleteProperty(draft.rewardTiers[1], "minScore"); })).toBe(true);
    expect(invalidWith((draft) => { Object.assign(draft.rewardTiers[1], { minPercent: 99 }); })).toBe(true);
  });

  it("requires unique room, task and hero ids", () => {
    expect(invalidWith((draft) => { draft.rooms[1].id = draft.rooms[0].id; })).toBe(true);
    expect(invalidWith((draft) => { draft.rooms[1].tasks[0].id = draft.rooms[0].tasks[0].id; })).toBe(true);
    expect(invalidWith((draft) => { draft.heroes[1].id = draft.heroes[0].id; })).toBe(true);
  });

  it("requires every speaker to be a known hero", () => {
    expect(invalidWith((draft) => { draft.rooms[0].tasks[0].heroId = "nobody"; })).toBe(true);
    expect(invalidWith((draft) => { draft.prologue.heroId = "nobody"; })).toBe(true);
  });

  it("rejects a pick whose correct option is missing or whose option ids repeat", () => {
    expect(invalidWith((draft) => { Object.assign(task(draft, "mail-invite"), { correctOptionId: "ghost" }); })).toBe(true);
    expect(invalidWith((draft) => {
      const pick = task(draft, "mail-invite");
      if (pick.type === "pick") pick.options[1].id = pick.options[0].id;
    })).toBe(true);
  });

  it("requires a build to have as many correct cards as slots and a trap card", () => {
    expect(invalidWith((draft) => { Object.assign(task(draft, "mail-answer"), { slots: 2 }); })).toBe(true);
    expect(invalidWith((draft) => {
      const build = task(draft, "mail-answer");
      if (build.type === "build") build.correctOptionIds = ["apology", "resend", "ghost"];
    })).toBe(true);
    expect(invalidWith((draft) => {
      const build = task(draft, "mail-answer");
      if (build.type === "build") build.options = build.options.filter((option) => build.correctOptionIds.includes(option.id));
    })).toBe(true);
  });

  it("requires the fake letter to be a known letter and keeps at least three letters", () => {
    expect(invalidWith((draft) => { Object.assign(task(draft, "mail-letters"), { fakeLetterId: "ghost" }); })).toBe(true);
    expect(invalidWith((draft) => {
      const phish = task(draft, "mail-letters");
      if (phish.type === "phish") phish.letters.splice(2);
    })).toBe(true);
  });

  it("rejects variant ids that hint at the answer", () => {
    for (const hint of ["fake", "genuine", "correct", "right_one", "wrong", "trap1", "isFake"]) {
      expect(invalidWith((draft) => {
        const pick = task(draft, "mail-invite");
        if (pick.type === "pick") pick.options[1].id = hint;
      })).toBe(true);
      expect(invalidWith((draft) => {
        const phish = task(draft, "mail-letters");
        if (phish.type === "phish") phish.letters[0].id = hint;
      })).toBe(true);
    }
  });

  it("requires the scene labels shown by the interface", () => {
    expect(invalidWith((draft) => { draft.scene.dateLabel = ""; })).toBe(true);
    expect(invalidWith((draft) => { Reflect.deleteProperty(draft, "scene"); })).toBe(true);
  });

  it("requires access answers to be known switches with at least one trap left off", () => {
    expect(invalidWith((draft) => { Object.assign(task(draft, "files-backup"), { correctEnabledIds: ["ghost"] }); })).toBe(true);
    expect(invalidWith((draft) => {
      const access = task(draft, "files-backup");
      if (access.type === "access") access.correctEnabledIds = access.switches.map((item) => item.id);
    })).toBe(true);
    expect(invalidWith((draft) => { Object.assign(task(draft, "files-backup"), { correctEnabledIds: ["daily", "daily"] }); })).toBe(true);
  });

  it("requires the order to be a permutation that is not shown pre-solved", () => {
    expect(invalidWith((draft) => { Object.assign(task(draft, "projects-stages"), { correctOrder: ["goal", "plan"] }); })).toBe(true);
    expect(invalidWith((draft) => { Object.assign(task(draft, "projects-stages"), { correctOrder: ["goal", "plan", "plan"] }); })).toBe(true);
    expect(invalidWith((draft) => {
      const order = task(draft, "projects-stages");
      if (order.type === "order") order.items = order.correctOrder.map((id) => order.items.find((item) => item.id === id)!);
    })).toBe(true);
  });

  it("requires a rush pool of at least 16 unique items with 3 to 4 security items", () => {
    expect(invalidWith((draft) => { draft.rush.pool = draft.rush.pool.slice(0, 15); })).toBe(true);
    expect(invalidWith((draft) => { draft.rush.pool[1].id = draft.rush.pool[0].id; })).toBe(true);
    expect(invalidWith((draft) => { draft.rush.pool.forEach((item) => { item.security = false; }); })).toBe(true);
    expect(invalidWith((draft) => { draft.rush.pool.forEach((item) => { item.security = true; }); })).toBe(true);
  });

  it("requires every rush answer to be one of the five services, each used at least once", () => {
    expect(invalidWith((draft) => { draft.rush.pool[0].serviceId = "ghost"; })).toBe(true);
    expect(invalidWith((draft) => { draft.rush.pool.forEach((item) => { if (item.serviceId === "files") item.serviceId = "mail"; }); })).toBe(true);
  });

  it("requires reward tiers to start at zero and strictly increase", () => {
    expect(invalidWith((draft) => { draft.rewardTiers[0].minScore = 10; })).toBe(true);
    expect(invalidWith((draft) => { draft.rewardTiers[2].minScore = draft.rewardTiers[1].minScore; })).toBe(true);
  });

  it("requires campaign dates in order", () => {
    expect(invalidWith((draft) => { draft.claimEndsAt = draft.startsAt; })).toBe(true);
  });
});

describe("эталонная кампания demo-office", () => {
  const tasks = campaign.rooms.flatMap((room) => room.tasks);

  it("has five rooms with fifteen tasks of all five types", () => {
    expect(campaign.rooms.map((room) => room.id)).toEqual(["mail", "calendar", "messenger", "files", "projects"]);
    expect(tasks).toHaveLength(15);
    expect(new Set(tasks.map((item) => item.type))).toEqual(new Set(["pick", "build", "phish", "access", "order"]));
  });

  it("follows the task table of the spec", () => {
    expect(tasks.map((item) => `${item.id}:${item.type}:${item.heroId}`)).toEqual([
      "mail-letters:phish:timur",
      "mail-invite:pick:lena",
      "mail-answer:build:marina",
      "calendar-standup:build:lena",
      "calendar-zones:pick:marina",
      "calendar-focus:pick:sofia",
      "chat-secret:pick:lena",
      "chat-status:pick:gleb",
      "chat-announce:build:lena",
      "files-backup:access:sofia",
      "files-names:pick:pasha",
      "files-usb:pick:timur",
      "projects-kanban:pick:marina",
      "projects-stages:order:lena",
      "projects-retro:build:marina"
    ]);
    for (const item of tasks.filter((candidate) => candidate.type === "build")) {
      expect(item.type === "build" && item.slots).toBe(3);
    }
  });

  it("gives every task a speaker's line, reactions, a tip and an explanation", () => {
    for (const item of tasks) {
      for (const text of [item.say, item.thanks, item.oops, item.tip, item.explanation]) {
        expect(text.trim().length).toBeGreaterThan(10);
      }
    }
  });

  it("keeps variant ids neutral in the shipped content", () => {
    const ids = tasks.flatMap((item): Array<{ id: string }> =>
      item.type === "phish" ? item.letters : item.type === "access" ? item.switches : item.type === "order" ? item.items : item.options
    ).map((variant) => variant.id);
    for (const id of ids) {
      expect(id).not.toMatch(REVEALING_ID_PATTERN);
    }
    const phish = tasks.find((item) => item.type === "phish")!;
    expect(phish.type === "phish" && phish.letters.map((letter) => letter.id).sort()).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });

  it("has a phishing task where an unmarked letter can still be genuine", () => {
    const phish = tasks.find((item) => item.type === "phish")!;
    if (phish.type !== "phish") throw new Error("unexpected type");
    const unmarked = phish.letters.filter((letter) => letter.mark === "none");
    expect(unmarked.length).toBeGreaterThanOrEqual(2);
    const genuine = unmarked.filter((letter) => letter.id !== phish.fakeLetterId);
    expect(genuine.length).toBeGreaterThanOrEqual(1);
    // Подделку отличают по домену и вложению, а не только по отметке.
    const fake = phish.letters.find((letter) => letter.id === phish.fakeLetterId)!;
    expect(fake.attachment).toMatch(/\.exe$/);
    for (const letter of genuine) expect(letter.attachment).not.toMatch(/\.exe$/);
  });

  it("keeps tariff prices and revenue figures out of the game", () => {
    const text = JSON.stringify(campaign);
    expect(text).not.toMatch(/499|309|19 млрд|₽/);
  });

  it("has a rush pool with the security items the spec asks for", () => {
    expect(campaign.rush.pool.length).toBeGreaterThanOrEqual(16);
    expect(campaign.rush.pool.filter((item) => item.security)).toHaveLength(4);
    expect(campaign.rush.services.map((service) => service.id)).toEqual(["mail", "calendar", "messenger", "files", "projects"]);
  });

  it("uses the level thresholds of the spec", () => {
    expect(campaign.rewardTiers.map((tier) => tier.minScore)).toEqual([0, 1700, 2400, 3000]);
  });
});

describe("campaign.legal", () => {
  it("legal.ts не тянет в клиентский бандл zod и схему кампании", () => {
    const source = readFileSync("tenants/demo-office/legal.ts", "utf8");
    expect(source).not.toMatch(/from\s+["'](zod|@\/config\/(schema|campaign))["']/);
  });

  it("requires operator, policy and consent texts", () => {
    expect(invalidWith((draft) => { Reflect.deleteProperty(draft, "legal"); })).toBe(true);
    expect(invalidWith((draft) => { draft.legal.operatorName = ""; })).toBe(true);
    expect(invalidWith((draft) => { draft.legal.policyText = "   "; })).toBe(true);
    expect(invalidWith((draft) => { draft.legal.consentText = ""; })).toBe(true);
  });

  it("names the operator and keeps draft texts marked", () => {
    expect(campaign.legal.operatorName).toBe("ООО «Северный офис» (демо)");
    expect(hasLegalPlaceholder(campaign.legal)).toBe(true);
    expect(campaign.legal.consentText).toContain(LEGAL_PLACEHOLDER);
    expect(campaign.legal.policyText).toContain(LEGAL_PLACEHOLDER);
  });

  it("detects the placeholder in any field and passes approved texts", () => {
    const approved = { operatorName: "Оператор", policyText: "Политика", consentText: "Согласие" };
    expect(hasLegalPlaceholder(approved)).toBe(false);
    for (const field of ["operatorName", "policyText", "consentText"] as const) {
      expect(hasLegalPlaceholder({ ...approved, [field]: `${LEGAL_PLACEHOLDER} текст` })).toBe(true);
    }
  });
});
