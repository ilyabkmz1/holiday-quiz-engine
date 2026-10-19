import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

import type { Brand } from "@/config/brand";
import { deriveTheme } from "@/config/theme";
import { parseHex } from "@/domain/color";
import { LruCache } from "@/server/lru";
import type { ShareSummary } from "@/server/share";

const WIDTH = 1200;
const HEIGHT = 630;

// Шрифты и фон читаются из public/: Dockerfile копирует его рядом с standalone-сервером.
// ImageResponse понимает woff (не woff2); кириллица и латиница — отдельные файлы, поэтому два имени гарнитуры
// со сквозным fallback. Satori не рисует WebP, поэтому фон — JPEG, снятый с worlds/snow-globe/globe.webp.
const publicFile = (...parts: string[]) => path.join(process.cwd(), "public", ...parts);

async function readFonts() {
  const files = [
    { name: "Onest", weight: 500 as const, file: "onest-cyrillic-500-normal.woff" },
    { name: "OnestLatin", weight: 500 as const, file: "onest-latin-500-normal.woff" },
    { name: "Onest", weight: 800 as const, file: "onest-cyrillic-800-normal.woff" },
    { name: "OnestLatin", weight: 800 as const, file: "onest-latin-800-normal.woff" }
  ];
  return Promise.all(
    files.map(async ({ name, weight, file }) => {
      const data = await readFile(publicFile("fonts", file));
      return { name, weight, style: "normal" as const, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer };
    })
  );
}

async function readBackground(webPath: string): Promise<string> {
  // Путь прошёл проверку схемы бренда (без «..», только jpg/png), но ещё раз не выходим из public/.
  const file = path.normalize(publicFile(...webPath.split("/").filter(Boolean)));
  if (!file.startsWith(publicFile() + path.sep)) throw new Error("Фон картинки вне public/");
  const data = await readFile(file);
  const type = webPath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${type};base64,${data.toString("base64")}`;
}

// Шрифты и фоны не меняются за время жизни процесса: читаем один раз (промис-синглтоны на уровне модуля,
// фоны — по пути файла, у каждого арендатора свой). Неудачное чтение не запоминаем, чтобы следующий запрос попробовал снова.
let fonts: ReturnType<typeof readFonts> | undefined;
const backgrounds = new Map<string, Promise<string>>();
async function loadAssets(webPath: string) {
  fonts ??= readFonts().catch((error: unknown) => {
    fonts = undefined;
    throw error;
  });
  let background = backgrounds.get(webPath);
  if (!background) {
    background = readBackground(webPath).catch((error: unknown) => {
      backgrounds.delete(webPath);
      throw error;
    });
    backgrounds.set(webPath, background);
  }
  return { fonts: await fonts, background: await background };
}

const formatScore = (score: number) => new Intl.NumberFormat("ru-RU").format(score).replace(/ /g, " ");

function Card({ summary, background, brand }: { summary: ShareSummary; background: string; brand: Brand }) {
  const theme = deriveTheme(brand.colors, brand.derived);
  const [red, green, blue] = parseHex(brand.colors.bg);
  const shade = (alpha: number) => `rgba(${red},${green},${blue},${alpha})`;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", backgroundColor: theme.bg, fontFamily: "Onest, OnestLatin", color: theme.ink }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse рисует через Satori, next/image тут неприменим */}
      <img src={background} width={WIDTH} height={HEIGHT} alt="" style={{ position: "absolute", top: 0, left: 0, width: WIDTH, height: HEIGHT, objectFit: "cover" }} />
      <div style={{ position: "absolute", top: 0, left: 0, width: WIDTH, height: HEIGHT, display: "flex", background: `linear-gradient(90deg, ${shade(0.96)} 0%, ${shade(0.82)} 55%, ${shade(0.35)} 100%)` }} />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: "56px 72px" }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 30, fontWeight: 800 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 14, backgroundColor: theme.blue, color: theme["on-accent"], fontSize: 22, marginRight: 16 }}>{brand.mark}</div>
          <div style={{ display: "flex" }}>{brand.wordmark}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 28, fontWeight: 500, color: theme.cyan, letterSpacing: 2, textTransform: "uppercase" }}>{summary.campaignTitle}</div>
          <div style={{ display: "flex", alignItems: "baseline", marginTop: 12 }}>
            <div style={{ display: "flex", fontSize: 168, fontWeight: 800, lineHeight: 1, color: theme.gold }}>{formatScore(summary.score)}</div>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 500, color: theme["muted-2"], marginLeft: 20 }}>очков</div>
          </div>
          <div style={{ display: "flex", marginTop: 20, fontSize: 52, fontWeight: 800, lineHeight: 1.15, maxWidth: 900 }}>{summary.tierTitle}</div>
        </div>
        <div style={{ display: "flex", fontSize: 28, fontWeight: 500, color: theme.muted }}>{brand.ogCall}</div>
      </div>
    </div>
  );
}

/** Готовые PNG по id сессии. Итог завершённой игры не меняется, поэтому запись не протухает; размер ограничен. */
export const SHARE_IMAGE_CACHE_SIZE = 500;
const pngCache = new LruCache<string, Uint8Array>(SHARE_IMAGE_CACHE_SIZE);
// Параллельные запросы одной картинки делят один рендер.
const rendering = new Map<string, Promise<Uint8Array>>();

export function getCachedShareImage(sessionId: string): Uint8Array | undefined {
  return pngCache.get(sessionId);
}

export function resetShareImageCache(): void {
  pngCache.clear();
  rendering.clear();
}

export function shareImageCacheSize(): number {
  return pngCache.size;
}

/** PNG 1200×630 для итога сессии `sessionId` (канонический id): из кэша или отрисованный и сохранённый в кэше. */
export function renderShareImage(sessionId: string, summary: ShareSummary, brand: Brand): Promise<Uint8Array> {
  const cached = pngCache.get(sessionId);
  if (cached) return Promise.resolve(cached);
  const inFlight = rendering.get(sessionId);
  if (inFlight) return inFlight;
  const job = (async () => {
    const assets = await loadAssets(brand.ogBackground);
    const response = new ImageResponse(<Card summary={summary} background={assets.background} brand={brand} />, { width: WIDTH, height: HEIGHT, fonts: assets.fonts });
    const png = new Uint8Array(await response.arrayBuffer());
    pngCache.set(sessionId, png);
    return png;
  })().finally(() => rendering.delete(sessionId));
  rendering.set(sessionId, job);
  return job;
}
