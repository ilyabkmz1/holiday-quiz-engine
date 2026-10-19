// Снимает бренд с сайта клиента: `npm run quiz:brand -- <slug> <url> [--apply]`.
// Через Playwright читает вычисленные цвета (фон страницы, кнопки, ссылки, заголовки), шрифт, favicon, og:image
// и логотип в шапке; печатает предложение для `brand`. С `--apply` записывает цвета в tenants/<slug>/pack.json (только pack.json).
// Результат — черновик: человек/агент проверяет контраст (`quiz:check`) и подбирает палитру под тёмную тему игры.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

import { FONT_IDS } from "../src/config/brand";
import { TENANT_SLUG_PATTERN } from "../src/config/pack";
import { contrastRatio, luminance, mix, toHex } from "../src/domain/color";

const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const [slug, url] = args;
const apply = process.argv.includes("--apply");
if (!slug || !url) {
  console.error("Использование: npm run quiz:brand -- <slug> <url> [--apply]");
  process.exit(2);
}
// slug попадает в путь tenants/<slug>/pack.json: принимаем только допустимое имя пакета, как и quiz:new.
if (!TENANT_SLUG_PATTERN.test(slug)) {
  console.error(`slug «${slug}» не годится: латиница в нижнем регистре, цифры и дефис, 2–41 символ (например, demo-coffee).`);
  process.exit(2);
}

const browser = await chromium.launch({ ...(process.env.E2E_BROWSER_EXECUTABLE ? { executablePath: process.env.E2E_BROWSER_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  // Код для страницы передаётся строкой: tsx/esbuild подмешивает в стрелочные функции вспомогательный `__name`, которого в браузере нет.
  const found = (await page.evaluate(`(() => {
    const css = (element, property) => (element ? getComputedStyle(element).getPropertyValue(property) : "");
    const meta = (selector, attribute) => (document.querySelector(selector) ? document.querySelector(selector).getAttribute(attribute) : null);
    const abs = (value) => (value ? new URL(value, location.href).toString() : null);
    const button = document.querySelector('button, a[class*="btn" i], a[class*="button" i], [role="button"]');
    const header = document.querySelector("header img, .logo img, a[class*='logo' i] img");
    return {
      title: document.title,
      pageBackground: css(document.body, "background-color") || css(document.documentElement, "background-color"),
      text: css(document.body, "color"),
      link: css(document.querySelector("a"), "color"),
      heading: css(document.querySelector("h1, h2"), "color"),
      buttonBackground: css(button, "background-color"),
      fontFamily: css(document.body, "font-family"),
      themeColor: meta('meta[name="theme-color"]', "content"),
      favicon: abs(meta('link[rel~="icon"]', "href")),
      ogImage: abs(meta('meta[property="og:image"]', "content")),
      logo: abs(header ? header.getAttribute("src") : null)
    };
  })()`)) as Record<string, string | null> & { title: string; pageBackground: string; link: string; heading: string; buttonBackground: string; fontFamily: string };

  const toRgb = (value: string): [number, number, number] | null => {
    const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(value);
    return match && (match[4] === undefined || Number(match[4]) > 0) ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const hex = (value: string | null) => {
    const rgb = value ? (value.startsWith("#") ? null : toRgb(value)) : null;
    return rgb ? toHex(rgb) : value?.startsWith("#") && value.length === 7 ? value.toLowerCase() : null;
  };

  const accent = hex(found.buttonBackground) ?? hex(found.link) ?? "#1a62e8";
  const siteBg = hex(found.pageBackground);
  // Игра тёмная: светлый фон сайта не переносим, а строим тёмный из акцента, чтобы палитра читалась.
  const bg = siteBg && luminance(siteBg) < 0.12 ? siteBg : mix("#000000", accent, 0.12);
  const panel = mix(bg, accent, 0.15);
  const ink = contrastRatio("#eef3ff", bg) >= 7 ? "#eef3ff" : "#ffffff";
  const fonts = found.fontFamily.toLowerCase();
  const font = FONT_IDS.find((id) => fonts.includes(id)) ?? "onest";

  const proposal = {
    colors: { bg, panel, ink, accent, accent2: hex(found.heading) && contrastRatio(hex(found.heading)!, bg) >= 3 ? hex(found.heading) : mix(accent, "#ffffff", 0.5), highlight: "#ffcb5c", danger: "#ff8a7a", success: "#6ee7a8" },
    font,
    sourceTitle: found.title,
    favicon: found.favicon,
    ogImage: found.ogImage,
    logo: found.logo
  };
  console.log(JSON.stringify(proposal, null, 2));
  console.log("\nhighlight, danger и success сайт не определяет: взяты значения по умолчанию (#ffcb5c, #ff8a7a, #6ee7a8). Подберите их под бренд клиента:");
  console.log("  highlight — очки и награды, danger — ошибки, success — успех (должны читаться на bg; проверит npm run quiz:check).");
  console.log(`\nШрифт сайта: ${found.fontFamily}${font === "onest" && !fonts.includes("onest") ? " (в allowlist нет, взят onest)" : ""}`);
  console.log("Логотип/og-картинку скачайте вручную в tenants/<slug>/assets/ и public/tenants/<slug>/, затем укажите путь в brand.logo.");

  if (apply) {
    const file = path.join("tenants", slug, "pack.json");
    const pack = JSON.parse(readFileSync(file, "utf8"));
    pack.campaign.brand.colors = proposal.colors;
    pack.campaign.brand.font = proposal.font;
    writeFileSync(file, `${JSON.stringify(pack, null, 2)}\n`);
    console.log(`Записано в ${file}: brand.colors, brand.font. Дальше: npm run quiz:check -- ${slug}`);
  }
} finally {
  await browser.close();
}
