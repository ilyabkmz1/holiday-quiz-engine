import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { deriveTheme, themeCss } from "@/config/theme";
import { adminChallenge } from "@/server/admin-gate";
import { authRealm } from "@/server/realm";
import { getTenant, overrideTenants, tenantCore } from "@/server/tenants";

const CSS_FILES = [
  "src/app/globals.css",
  "src/components/quest/quest.css",
  "src/app/share/[sessionId]/share.css",
  "src/app/privacy/privacy.css",
  "src/app/admin/admin.css"
];
// Без комментариев и без блока `:root` в globals.css: там запасная палитра, её сверяет tests/unit/brand.test.ts.
const read = (file: string) =>
  readFileSync(join(process.cwd(), file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^:root \{[^}]*\}\n/m, "");

describe("CSS без захардкоженных цветов бренда", () => {
  for (const file of CSS_FILES) {
    it(file, () => {
      const css = read(file);
      // Нейтральные белый и чёрный (с альфой) допустимы: тени, блики, подложки.
      const hexes = (css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).filter((hex) => !/^#(fff|ffffff|000|000000)$/i.test(hex));
      expect(hexes, "hex-цвета").toEqual([]);
      const functions = [...css.matchAll(/\brgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)]
        .map((match) => `${match[1]},${match[2]},${match[3]}`)
        .filter((channels) => channels !== "0,0,0" && channels !== "255,255,255");
      expect(functions, "rgb()/rgba() с цветом бренда").toEqual([]);
      expect(css, "шрифт берётся из --font").not.toMatch(/font-onest/);
    });
  }

  it("каждая var(--…) из CSS определена темой, шрифтом, картинкой или самим CSS", () => {
    const defined = new Set([...Object.keys(deriveTheme(tenantCore(getTenant("demo-coffee")).brand.colors)), "font", "page-art"]);
    const local = new Set<string>();
    // Переменные, которые компоненты задают инлайн (`style={{ "--x": … }}`).
    for (const file of execSync("git ls-files 'src/**/*.tsx'", { encoding: "utf8" }).split("\n").filter(Boolean)) {
      for (const match of readFileSync(file, "utf8").matchAll(/["'`]--([\w-]+)["'`]/g)) local.add(match[1]);
    }
    for (const file of CSS_FILES) for (const match of read(file).matchAll(/(--[\w-]+)\s*:/g)) local.add(match[1].slice(2));
    const missing = new Set<string>();
    for (const file of CSS_FILES) {
      for (const match of read(file).matchAll(/var\(--([\w-]+)(,)?/g)) {
        // С запасным значением (`var(--x, 1)`) переменная может задаваться на элементе.
        if (!match[2] && !defined.has(match[1]) && !local.has(match[1])) missing.add(match[1]);
      }
    }
    expect([...missing]).toEqual([]);
  });
});

describe("тема арендатора", () => {
  it("demo-office сохраняет заданные под иллюстрацию мира цвета, остальное выводит из палитры; demo-coffee получает свою палитру целиком", () => {
    const office = tenantCore(getTenant("demo-office")).brand;
    const coffee = tenantCore(getTenant("demo-coffee")).brand;
    const officeTheme = deriveTheme(office.colors, office.derived);
    // Явно заданные в пакете производные (цвета иллюстрации snow-globe) не пересчитываются.
    expect(officeTheme.void).toBe("#020a30");
    expect(officeTheme.patch).toBe("#031f61");
    // Не заданные явно выводятся из палитры бренда.
    expect(officeTheme.haze).toBe("#96c5b8");
    const coffeeTheme = deriveTheme(coffee.colors, coffee.derived);
    for (const key of Object.keys(officeTheme)) expect(coffeeTheme[key], key).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    expect(coffeeTheme.haze).not.toBe(officeTheme.haze);
    expect(coffeeTheme["danger-strong"]).not.toBe(officeTheme["danger-strong"]);
  });

  it("themeCss подставляет картинку страницы только из безопасного пути", () => {
    const { colors } = tenantCore(getTenant("demo-coffee")).brand;
    expect(themeCss(colors, {}, "x", "/art/a.webp")).toContain('--page-art:url("/art/a.webp")');
    expect(themeCss(colors, {}, "x", '/a");}body{x:y')).toContain("--page-art:none");
    expect(themeCss(colors, {}, "x")).toContain("--page-art:none");
    expect(themeCss(colors, {}, "x", "//evil.example/a.webp")).toContain("--page-art:none");
  });
});

describe("realm Basic auth", () => {
  it("берётся из бренда арендатора по Host, а при неопределённом арендаторе нейтральный", () => {
    // Латинское имя бренда попадает в realm как есть.
    const office = getTenant("demo-office");
    if (!("campaign" in office)) throw new Error("demo-office должен быть квизом");
    const latin = { ...office, tenant: "latin-brand", hosts: ["latin.localhost:3000"], campaign: { ...office.campaign, brand: { ...office.campaign.brand, name: "Nord Office" } } };
    overrideTenants([latin]);
    expect(authRealm("latin.localhost:3000")).toBe("Nord Office Quiz");
    expect(authRealm("latin.localhost:3000", "staging")).toBe("Nord Office Quiz staging");
    overrideTenants(null);
    // Кириллическое имя («Северный офис») в заголовок не попадает: Headers принимает только ByteString.
    expect(authRealm("demo-office.localhost:3000")).toBe("Quiz");
    // Кириллическое имя («Кофейня «Зерно»») в заголовок не попадает: Headers принимает только ByteString.
    expect(authRealm("demo-coffee.localhost:3000", "staging")).toBe("Quiz staging");
    expect(adminChallenge(authRealm("demo-coffee.localhost:3000")).headers.get("www-authenticate")).toBe('Basic realm="Quiz", charset="UTF-8"');
    const previous = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string>).NODE_ENV = "production";
      expect(authRealm("unknown.example.com")).toBe("Quiz");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = previous;
    }
  });
});
