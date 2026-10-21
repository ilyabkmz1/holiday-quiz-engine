import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  typedRoutes: false,
  // Картинки локальные и уже оптимизированы (WebP). Оптимизатор next/image ходит за ними сам без заголовка
  // Authorization и на закрытом стенде (Basic auth) получал бы 401, поэтому он отключён.
  images: { unoptimized: true },
  // Только `next dev`: туннель для показа мини-приложения в Telegram (docs/engine/TELEGRAM_MINIAPP.md). Свой туннель — ALLOWED_DEV_ORIGINS=хост1,хост2.
  allowedDevOrigins: ["*.trycloudflare.com", ...(process.env.ALLOWED_DEV_ORIGINS?.split(",").map((host) => host.trim()).filter(Boolean) ?? [])],
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        // Защита от встраивания (X-Frame-Options / frame-ancestors) выставляет src/proxy.ts по арендатору: адвенту с Telegram нужен фрейм Telegram Web.
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
      ]
    }];
  }
};

export default nextConfig;
