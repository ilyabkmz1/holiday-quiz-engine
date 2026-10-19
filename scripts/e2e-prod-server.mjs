// Production-сервер для E2E (E2E_SERVER=prod): тот же standalone server.js, что запускает Dockerfile.
// Сборка выполняется здесь, если не задан E2E_SKIP_BUILD=1 (в CI она вынесена в отдельный шаг с кешем).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (process.env.E2E_SKIP_BUILD !== "1") {
  const build = spawnSync("npm", ["run", "build"], { stdio: "inherit", env: process.env });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

if (!existsSync(join(standalone, "server.js"))) {
  console.error("Нет .next/standalone/server.js: выполните npm run build (output: standalone).");
  process.exit(1);
}

// Как в Dockerfile: standalone не включает статику и public.
rmSync(join(standalone, ".next", "static"), { recursive: true, force: true });
rmSync(join(standalone, "public"), { recursive: true, force: true });
cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });

const appUrl = new URL(process.env.APP_URL);
const server = spawn("node", ["server.js"], {
  cwd: standalone,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: appUrl.hostname.replace(/^\[|\]$/g, ""),
    PORT: appUrl.port || (appUrl.protocol === "https:" ? "443" : "80")
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
