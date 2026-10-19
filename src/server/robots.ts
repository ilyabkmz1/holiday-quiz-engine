import type { MetadataRoute } from "next";

import { isStagingEnabled, type RuntimeEnv } from "@/server/env";

type RobotsEnv = Partial<Pick<RuntimeEnv, "STAGING_USERNAME" | "STAGING_PASSWORD">>;

/**
 * Правила индексации. Закрытый стенд (заданы STAGING_*) закрыт целиком. В production индексируются
 * только главная и страницы результата `/share/*`; `$` у главной — точное совпадение, иначе `Allow: /`
 * открыл бы всё. Остальное закрыто общим `Disallow: /`, а служебные пути перечислены явно, чтобы запрет
 * читался и сохранялся, если общее правило когда-нибудь ослабят.
 */
export function robotsRules(env: RobotsEnv): MetadataRoute.Robots {
  if (isStagingEnabled(env)) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/share/"],
      disallow: ["/admin", "/api", "/verify", "/quest", "/redeem", "/"]
    }
  };
}
