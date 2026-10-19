import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { campaign } from "@tenants/demo-office/campaign";
import { FONT_IDS } from "@/config/brand";
import { campaignSchema } from "@/config/schema";
import { contrastIssues, deriveTheme, themeCss } from "@/config/theme";
import { contrastRatio, mix } from "@/domain/color";
import { publicCampaign } from "@/server/presentation";

import { smallCampaign } from "../support/small-campaign";

const invalidWith = (edit: (draft: ReturnType<typeof structuredClone<typeof campaign>>) => void) => {
  const draft = structuredClone(campaign);
  edit(draft);
  return !campaignSchema.safeParse(draft).success;
};

describe("цвета", () => {
  it("контраст WCAG: чёрный на белом 21, одинаковые цвета 1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#336699", "#336699")).toBeCloseTo(1, 5);
  });

  it("смешивание", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

describe("тема из пакета", () => {
  // Регрессия эталонного пакета: переменные demo-office совпадают с литералами :root в globals.css (запасная палитра).
  it("переменные эталонного пакета совпадают с :root в globals.css", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const root = css.slice(css.indexOf(":root {"), css.indexOf("}\n", css.indexOf(":root {")));
    const theme = deriveTheme(campaign.brand.colors, campaign.brand.derived);
    for (const [name, value] of Object.entries(theme)) {
      if (name === "line") continue;
      const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(root);
      expect(match, `--${name} есть в :root`).not.toBeNull();
      const expected = value === "#ffffff" ? ["#fff", "#ffffff"] : [value];
      expect(expected, `--${name}`).toContain(match![1].trim().toLowerCase());
    }
  });

  it("в стилях вне :root не осталось цветов палитры (кроме художественных)", () => {
    const paletteHex = /#(07161c|0c222b|0d2b30|0e3c39|eef8f6|9da9aa|cbd6d5|6fe3c6|ffc861|ffe1a8|ff8f80|7ee8ad|13795b|f5fbfa|5b6d72|1b1300)\b/gi;
    for (const file of ["src/app/globals.css", "src/components/quest/quest.css", "src/app/share/[sessionId]/share.css", "src/app/admin/admin.css", "src/app/privacy/privacy.css"]) {
      let css = readFileSync(file, "utf8");
      if (file.endsWith("globals.css")) css = css.slice(css.indexOf("}\n") + 2);
      expect(css.match(paletteHex) ?? [], file).toEqual([]);
    }
  });

  it("themeCss содержит все переменные и шрифт и ничего лишнего", () => {
    const css = themeCss(campaign.brand.colors, campaign.brand.derived, "var(--font-onest), sans-serif");
    expect(css.startsWith("html:root{")).toBe(true);
    expect(css).toContain("--bg:#07161c");
    expect(css).toContain("--font:var(--font-onest), sans-serif");
    expect(css).not.toMatch(/[<>]/);
  });

  it("без явных производных цветов считает их сам и выбирает читаемый цвет текста на кнопках", () => {
    const light = { bg: "#ffffff", panel: "#f5efe6", ink: "#2a1a10", accent: "#7b3f00", accent2: "#a15c1c", highlight: "#a8740a", danger: "#b3261e", success: "#1b6e3c" };
    const theme = deriveTheme(light);
    expect(theme["on-accent"]).toBe("#ffffff");
    expect(theme["on-gold"]).toBe("#1b1300");
    expect(contrastIssues(light)).toEqual([]);
  });

  it("ловит нечитаемую палитру", () => {
    const issues = contrastIssues({ ...campaign.brand.colors, ink: "#222a40" }, {});
    expect(issues.length).toBeGreaterThan(0);
    expect(invalidWith((draft) => { draft.brand.colors.ink = "#0a1330"; })).toBe(true);
  });
});

describe("brand / story / copy в схеме", () => {
  it("шрифт только из allowlist, цвета только #RRGGBB, пути без «..»", () => {
    expect(FONT_IDS).toContain(campaign.brand.font);
    expect(invalidWith((draft) => { Object.assign(draft.brand, { font: "comic-sans" }); })).toBe(true);
    expect(invalidWith((draft) => { draft.brand.colors.bg = "red"; })).toBe(true);
    expect(invalidWith((draft) => { draft.brand.logo = "/../../etc/x.png"; })).toBe(true);
    expect(invalidWith((draft) => { draft.brand.ogBackground = "/art/../x.jpg"; })).toBe(true);
    expect(invalidWith((draft) => { draft.brand.derived.line = "red;} body{display:none"; })).toBe(true);
    for (const pageArt of ['/a");}body{x:y}.webp', "//evil.example/a.webp", "/art/../x.webp", "/a\n.webp", "/a\\b.webp", "javascript:x.webp", "data:image/png,x.png", "https://evil.example/a.webp", "/a.svg"]) {
      expect(invalidWith((draft) => { draft.brand.pageArt = pageArt; }), pageArt).toBe(true);
    }
    expect(invalidWith((draft) => { draft.brand.pageArt = "/worlds/snow-globe/globe.webp"; })).toBe(false);
  });

  it("тексты интерфейса получают дефолты, пакет может их переопределить", () => {
    expect(campaign.copy.ornamentsAria).toBe("Игрушки на ёлке");
    const draft = structuredClone(campaign);
    draft.copy = { ornamentsAria: "Огоньки гирлянды" } as typeof draft.copy;
    const parsed = campaignSchema.parse(draft);
    expect(parsed.copy.ornamentsAria).toBe("Огоньки гирлянды");
    expect(parsed.copy.hangOrnament).toBe("К ёлке: повесить игрушку");
  });

  it("публичная кампания отдаёт бренд и тексты, но не палитру и не почтовую тему", () => {
    const view = publicCampaign(smallCampaign());
    expect(view.brand.name).toBe("Северный офис");
    const text = JSON.stringify(view);
    expect(text).not.toContain("mailSubject");
    expect(text).not.toContain('"colors"');
  });
});
