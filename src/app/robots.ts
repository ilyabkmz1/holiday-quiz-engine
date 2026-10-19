import type { MetadataRoute } from "next";

import { getRuntimeEnv } from "@/server/env";
import { robotsRules } from "@/server/robots";

// Режим (staging или production) известен только при запуске, не при сборке.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return robotsRules(getRuntimeEnv());
}
