/**
 * Чистые помощники для `quiz:export` и `quiz:preview`: что и в каком порядке запускать. Сами команды выполняют scripts/quiz-*.ts,
 * поэтому план проверяется юнит-тестами без Docker, SSH и сети.
 */

export type Step = { title: string; command: string; args: string[]; env?: Record<string, string> };

const DOMAIN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/;
export const isDomain = (value: string): boolean => DOMAIN.test(value);

/** Заменяет или добавляет `KEY=value` в тексте `.env` (значение буквально); остальные строки не трогает. */
export function setEnvLines(text: string, entries: Record<string, string>): string {
  const lines = text.split("\n");
  for (const [key, value] of Object.entries(entries)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
  }
  return lines.join("\n");
}

export type ExportOptions = {
  slug: string;
  outDir: string;
  domain?: string;
  email?: string;
  smtpFrom?: string;
  /** Собрать образы app и migrate с единственным пакетом и сохранить архивом (нужен Docker). */
  build?: boolean;
  version?: string;
};

/** Шаги экспорта для сервера клиента: секреты через deploy/generate-secrets.sh, затем (по флагу) образы только с пакетом клиента. */
export function exportSteps(options: ExportOptions): Step[] {
  const { slug, outDir } = options;
  const version = options.version ?? "dev";
  const steps: Step[] = [
    {
      title: "Секреты и .env клиента (deploy/generate-secrets.sh, права 600)",
      command: "bash",
      args: [
        "deploy/generate-secrets.sh",
        "production",
        "--force",
        ...(options.domain ? ["--domain", options.domain] : []),
        ...(options.email ? ["--email", options.email] : []),
        ...(options.smtpFrom ? ["--smtp-from", options.smtpFrom] : [])
      ],
      // Скрипт пишет в $QUIZ_ROOT/.env: подставляем каталог экспорта, а не /opt/quiz.
      env: { QUIZ_ROOT: outDir }
    }
  ];
  if (options.build) {
    for (const target of ["runner", "migrate"] as const) {
      steps.push({
        title: `Образ ${target} только с пакетом ${slug}`,
        command: "docker",
        args: ["build", "--target", target, "--build-arg", `QUIZ_PACKS=${slug}`, "--build-arg", `APP_VERSION=${version}`, "-t", `quiz-${slug}-${target === "runner" ? "app" : "migrate"}:${version}`, "."]
      });
    }
    steps.push({
      title: "Архив образов для переноса на сервер клиента",
      command: "sh",
      args: ["-c", `docker save quiz-${slug}-app:${version} quiz-${slug}-migrate:${version} | gzip > ${JSON.stringify(`${outDir}/quiz-${slug}-images.tar.gz`)}`]
    });
  }
  return steps;
}

/** Записи `.env` клиента поверх сгенерированного шаблона: один арендатор, образ только с его пакетом. */
export const exportEnv = (slug: string): Record<string, string> => ({ TENANT: slug, QUIZ_PACKS: slug });

export function exportReadme(slug: string, options: { domain?: string; built: boolean }): string {
  const domain = options.domain ?? "<домен клиента>";
  return [
    `# Сервер клиента: квиз ${slug}`,
    "",
    "Файлы этой папки созданы `npm run quiz:export`. Секреты лежат в `.env` (права 600) — в git и в чаты не передавайте.",
    "",
    "## Что внутри",
    "- `.env` — окружение production для `/opt/quiz/.env` на сервере клиента: `TENANT` и `QUIZ_PACKS` равны `" + slug + "`, секреты сгенерированы. Заполните вручную `ACME_EMAIL`, SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`)" + (options.domain ? "." : " и домен: `deploy/generate-secrets.sh --set-domain <домен>`."),
    options.built ? `- \`quiz-${slug}-images.tar.gz\` — образы app и migrate только с этим пакетом (\`docker load < …\`).` : "- Образы не собирались: сервер собирает их сам при `deploy/deploy.sh` (в `.env` уже стоит `QUIZ_PACKS=" + slug + "`).",
    "",
    "## Выкатка (подробно — deploy/README.md)",
    `1. DNS: A-запись \`${domain}\` на IP сервера клиента.`,
    "2. Bootstrap сервера: `deploy/bootstrap-vm.sh` (раздел 4 runbook).",
    "3. Клонировать репозиторий в `/opt/quiz/app`, положить `.env` в `/opt/quiz/.env` (`chmod 600`).",
    "4. `deploy/deploy.sh` — сборка (только пакет клиента), миграции и seed, запуск, проверки; затем `deploy/smoke.sh`.",
    `5. Оператор клиента: \`DATABASE_URL=… npm run quiz:admin -- ${slug} --user ops\` — пароль печатается один раз.`,
    "6. Перед запуском: юридические тексты без маркера «на согласовании», настоящий SMTP, бэкап и проверка восстановления (раздел 9 runbook).",
    ""
  ].join("\n");
}

export type PreviewOptions = {
  slug: string;
  /** Общий домен сервера: превью живёт на `<slug>.<baseDomain>`. */
  baseDomain: string;
  /** `user@host` общего сервера; без него шаги выкатки только печатаются. */
  ssh?: string;
  ref?: string;
  appDir?: string;
};

export const previewUrl = ({ slug, baseDomain }: Pick<PreviewOptions, "slug" | "baseDomain">): string => `https://${slug}.${baseDomain}/`;

/** Команды выкатки превью на общий сервер через существующие deploy/deploy.sh и deploy/smoke.sh. */
export function previewSteps(options: PreviewOptions): Step[] {
  const dir = options.appDir ?? "/opt/quiz/app";
  const ref = options.ref ?? "origin/main";
  const target = options.ssh ?? "<user@host>";
  return [
    { title: "Выкатка на общий сервер", command: "ssh", args: [target, `cd ${dir} && deploy/deploy.sh ${ref}`] },
    { title: "Дымовая проверка стека", command: "ssh", args: [target, `cd ${dir} && deploy/smoke.sh --local`] }
  ];
}

/** Проблемы git-состояния, из-за которых превью не покажет пакет: незакоммиченные файлы пакета и ветка, которой нет на сервере. */
export function previewGitIssues(input: { dirtyPaths: string[]; remoteBranches: string[] }): string[] {
  const issues: string[] = [];
  if (input.dirtyPaths.length > 0) issues.push(`не закоммичены файлы пакета: ${input.dirtyPaths.join(", ")}`);
  if (input.remoteBranches.length === 0) issues.push("текущий коммит не отправлен в origin (git push): сервер выкатывает только то, что есть в репозитории");
  return issues;
}
