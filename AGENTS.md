<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Деплой

Боевая выкатка на облачную ВМ (любой провайдер в РФ; Ubuntu 24.04, Docker Compose, Caddy с Let's Encrypt, Postgres, бэкапы) описана в [`deploy/README.md`](deploy/README.md) — это единственный источник правды, читайте его целиком до любых действий на ВМ. Скрипты лежат в `deploy/*.sh`, секреты — только в `/opt/quiz/.env` на ВМ.

Правила для агента:

- Никогда не коммитьте `.env` и любые секреты (пароли, SMTP, staging/admin-доступ, ключи). В git только `deploy/.env.*.example` с заглушками `CHANGE_ME_*`; секреты в чат и логи не выводите.
- Не выключайте staging-авторизацию (`STAGING_*`) и `QUIZ_FORCE_OPEN`, не переводите стенд в production (`deploy/switch-mode.sh production`) без прямой команды владельца.
- Перед переключением в production и перед любым рискованным действием с БД сделайте бэкап (`deploy/backup-now.sh`) и проверьте восстановление (`deploy/restore.sh latest`).
- Выкатывайте только через `deploy/deploy.sh` (он сам делает дамп перед миграциями), проверяйте `deploy/smoke.sh`; на ВМ код руками не правят.
- Откат — `deploy/rollback.sh`; БД он не откатывает (миграции аддитивные), возврат данных из дампа — только `deploy/restore.sh --full` по решению владельца.

## Сборка квизов под ключ

Новый квиз — пакет `tenants/<slug>/`, а не правка кода. Пошаговый скилл (бриф → пакет → `quiz:check` → скриншоты → превью) лежит в [`.claude/skills/build-quiz/SKILL.md`](.claude/skills/build-quiz/SKILL.md); в Codex и других агентах откройте этот файл и следуйте ему. Шаблон ТЗ — `docs/brief-template.md`, пример — `docs/examples/brief-demo-coffee.md`, эталонный пакет квеста — `tenants/demo-office/`, команды `npm run quiz:*` описаны в `README.md`, правила игры — `docs/game/MECHANICS.md`. Факты о продуктах клиента берите только из брифа. Пакеты реальных клиентов в этот репозиторий не коммитьте: они живут в отдельном приватном репозитории и копируются в `tenants/` при сборке (README, раздел «Как добавить приватный пакет клиента»).
