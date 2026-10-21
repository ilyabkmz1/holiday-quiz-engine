# Инструкции для coding-агентов

Проект — white-label движок праздничных квизов, квестов и адвент-календарей на Next.js 16, React 19, TypeScript, PostgreSQL и Prisma. Квиз конкретного клиента — пакет данных `tenants/<slug>/`, механика общая. Перед изменениями прочитайте `AGENTS.md`: Next.js автоматически поддерживает в нём правила для текущей версии фреймворка, там же — правила деплоя и сборки пакетов.

## Быстрый старт

Требуются Node.js 22, PostgreSQL и SMTP. Для локального полного контура используется Docker Compose с PostgreSQL и Mailpit.

```bash
npm ci
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Либо:

```bash
docker compose up --build
```

Приложение будет доступно на `http://localhost:3000`, Mailpit — на `http://localhost:8025`.

## Проверки

Перед передачей изменений выполните:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run quiz:check -- --all
TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/quiz_test npm run test:integration
DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run build
```

`npm run test:integration` требует настоящий PostgreSQL в `TEST_DATABASE_URL` (имя базы начинается с `test_` или оканчивается на `_test`); без переменной набор пропускается с сообщением. Как поднять базу — в `README.md`, раздел «Интеграционные тесты». Менять репозитории, сервисы или route handlers без прогона этого набора нельзя: in-memory версии не ловят ограничения и гонки PostgreSQL.

E2E-тесты требуют запущенного приложения и окружения из `playwright.config.ts`:

```bash
npm run test:e2e                        # dev-сервер (по умолчанию), эталонный пакет demo-office; другой — E2E_TENANT=<slug>
npm run test:e2e:tenants                # на каждом пакете по очереди (так гоняет CI)
E2E_SERVER=prod npm run test:e2e       # production-сборка: npm run build + standalone server.js (так гоняет CI)
```

В prod-режиме `E2E_SKIP_BUILD=1` пропускает сборку; `QUIZ_LOCAL_STACK=true` Playwright ставит сам. Подробности — в `README.md`, раздел «E2E».

## Карта проекта

- `tenants/<slug>/` — пакет арендатора. `tenants/demo-office/` — эталонный пакет квеста (вымышленный «Северный офис», мир `snow-globe`) и регрессионная база тестов: `campaign.ts` — тексты, герои, пять зон по три задания, пул финального рывка, правильные ответы и уровни наград; `legal.ts` — юридические тексты; `pack.ts` — паспорт пакета. `tenants/demo-coffee/pack.json` — демо режима карточек; `tenants/demo-coffee-advent/` и `tenants/demo-team-advent/` — демо адвента (`demo: true`, время двигает `?asOf=`). `tenants/index.ts` — манифест собранных пакетов (маркеры `// quiz:new-import` и `// quiz:new-append`).
- `src/config/pack.ts` — схема пакета; `src/config/schema.ts` — валидируемый контракт кампании; `src/config/brand.ts` — бренд, история, тексты интерфейса; `src/config/legal.ts` — общие типы и маркер `LEGAL_PLACEHOLDER`; `src/config/theme.ts` — дизайн-токены; `src/config/advent-schema.ts` — адвент.
- `src/server/tenants.ts` — реестр и выбор арендатора по `Host`/`TENANT`.
- `src/domain/` — чистые правила: `tasks.ts` (разбор ответов), `scoring.ts` (комбо, бонусы, уровни, `maxScore`), `rush.ts` (дедлайн финального рывка), `advent/`. Описание правил — `docs/game/MECHANICS.md`.
- `src/domain/errors.ts` — `DomainError` с кодом (`not_found`/`conflict`/`invalid`/`expired`); `apiError()` в `src/server/api.ts` переводит код в HTTP-статус.
- `src/types/api.ts` — контракт публичного API игры; описание путей — в README.
- `src/server/services/` — серверная логика сессий, рывка, призовых заявок, адвента и входа по ссылке.
- `src/server/repositories/` — PostgreSQL- и in-memory-репозитории.
- `src/app/api/` — публичные и операторские API.
- `src/app/admin/`, `src/server/metrics.ts` — панель оператора (SQL-агрегаты, маска email); `src/app/share/`, `src/server/share.ts` — публичный итог и картинка «Поделиться»; `src/app/privacy/`, `src/app/robots.ts`.
- `src/components/game/` — режим карточек (`mode: "cards"`): `QuizGame.tsx` (состояние и восстановление по данным сервера), экраны (`Prologue`, `MapScreen`, `RoomScreen`, `RushScreen`, `FinalScreen`), механики заданий в `tasks/`, клиент API в `api.ts`. Стили — `src/app/globals.css`. Скриншоты экранов: `npx tsx scripts/screens.ts <каталог>` при запущенном dev-сервере (адрес — `APP_URL`).
- `src/components/play/` — общий слой обоих режимов без оболочки: `useSessionBoot` (сессия, ошибки API), `useRoomFlow` (вход, задание, ответ, разбор, итог, восстановление), `TaskMechanic`, `RoomSummaryTable`, звук (`sound.ts`, `SoundButton`), контекст мира (`world-context.tsx`).
- `src/components/quest/` — режим квеста (основной, `mode: "quest"`): `QuestGame` (оболочка и фазы, `phase.ts` — редьюсер), `QuestWorld` (rAF-цикл), `sim.ts` (чистая симуляция ходьбы), `camera.ts`, `WorldLayer`, `ScreenOverlay`/`overlay.ts` (облачка, маяк), `Celebration`, `QuestRoomFlow` (карточка), `QuestPrologue`, `useRush`, `QuestFinal`, `sprites.tsx` (слой спрайтов). `/quest` — превью за флагом `src/server/quest-flag.ts`.
- `facades/<id>/facade.json` и `src/facades/registry.ts` — библиотека фасадов «Витрины» адвента (форма крыши, окон и двери, цвета-токены бренда; схема — `src/config/facade.ts`; раскладка окон — `src/domain/advent/facade-layout.ts`, гирлянда-шкала — `garland.ts`).
- `src/components/advent/` — клиент адвента: `AdventGame` (загрузка, фазы), `CalendarView`, `DaySheet`, `LuckReveal`, `PromoCard` (QR), `StreakHud`, `SaveProgressCard`, `AdventFinale`, вход по ссылке (`AdventLogin`); «Витрина» (`presentation: storefront`) — `storefront/` (`Storefront`, `Facade`, `StreetHost` + `useStreetWalker` (хозяин ходит по улице; чистая арифметика — `src/domain/advent/street-walk.ts`), `Garland`, `HeroSays`, `StepRail`, обложки заданий `skins/`, стили `storefront.css`); стили — `advent.css` (только переменные бренда). Метрики (A7): `src/server/advent-metrics.ts` (сборка `loadAdventAnalytics`, публичный рейтинг команд `loadTeamLeaderboard`), SQL-агрегаты — `analyticsRaw`/`teamStats` в репозиториях (контракт `tests/support/advent-analytics-contract.ts`, ручные ожидания), правила и выводы — `src/domain/advent/analytics.ts`, `insights.ts`, панель `src/app/admin/AdventAdmin.tsx` + `advent-charts.tsx`, отчёт `src/app/admin/report/`, демо-данные `src/tools/advent-seed-demo.ts` (`npm run advent:seed-demo -- <slug>`), рейтинг в клиенте — `TeamBoard`. E2E адвента — `npm run test:e2e:advent` (`tests/e2e-advent/`, пакет `demo-coffee-advent`), скриншоты — `npm run advent:shots -- <slug>`.
- `src/worlds/` — схема, загрузчик и расчётная модель миров; `worlds/<id>/world.json` — разметка; `public/worlds/<id>/` — иллюстрации; `public/art/` — фон картинки «Поделиться».
- `src/proxy.ts` + `src/server/staging-gate.ts` — закрытый стенд (HTTP Basic auth на весь сайт при заданных `STAGING_USERNAME`/`STAGING_PASSWORD`; в Next.js 16 middleware называется proxy), `src/server/admin-gate.ts` + `admin-auth.ts` + `admin.ts` — замок страниц и API `/admin` строго в рамках арендатора по Host (логины `TenantAdmin` с хешем scrypt, `quiz:admin`; `ADMIN_*` — только при `TENANT` или `SUPERADMIN=true`), `tls-ask.ts` — проверка домена для Caddy (on-demand TLS).
- `prisma/schema.prisma` и `prisma/migrations/` — модель данных и миграции.
- `scripts/` — CLI `quiz:*` (в том числе адвент: `quiz:new --experience advent`, `quiz:rules`, `quiz:shots --day`; логика в `src/tools/advent-*.ts`), `select-packs.mjs` (образ только с нужными пакетами, build-аргумент `QUIZ_PACKS`), очистка ПДн, нагрузочный smoke.
- `deploy/` — выкатка на облачную ВМ (Compose, Caddy, скрипты, бэкапы); runbook — `deploy/README.md`.
- `tests/unit/`, `tests/components/`, `tests/integration/`, `tests/e2e/` — автоматические проверки.

## Обязательные инварианты

- Баллы рассчитываются только сервером. Не передавайте правильные ответы и признаки правильности до фиксации ответа на это задание (публичное представление собирает `src/server/presentation.ts` явным списком полей).
- Один ответ на задание, один ответ на заявку финального рывка, вход в комнату и финализация результата должны оставаться идемпотентными.
- Время, комбо, бонусы и дедлайн рывка определяет только сервер по своим отметкам времени (часы подменяются через `overrideServices`).
- Подтверждение заявки и уникальность нормализованного email должны оставаться атомарными.
- Ожидаемые ошибки бросайте как `DomainError` с русским сообщением для пользователя; статус по тексту сообщения не выводится, любая другая ошибка отдаётся как 500 с общим текстом.
- Не пишите в логи email, поля формы, токены подтверждения, SMTP- или admin-секреты.
- Токены подтверждения хранятся только в виде хеша.
- Не переносите контент клиента в механику сессий: задания, названия и бренд должны оставаться в пакете арендатора.
- Учитывайте клавиатурную навигацию и `prefers-reduced-motion` при добавлении анимаций.

## Изменение контента и дизайна

Тексты заданий эталонного пакета меняются в `tenants/demo-office/campaign.ts`; после правок запускайте `npm run quiz:check -- demo-office` и тесты схемы, заданий и сессий: на этом пакете держится регрессия движка. Новый квиз — новый пакет (скилл `.claude/skills/build-quiz/SKILL.md`), а не правка кода. Зоны связаны с точками мира полем `spotId`. Основные стили и анимации находятся в `src/app/globals.css` и `src/components/quest/quest.css`.

Не добавляйте исходные презентации клиентов, их пакеты, `.env` или другие секреты в Git. Перед production остаются внешние блокеры из README: утверждение заданий и подарков, юридический текст, SMTP/TLS, production-секреты и проверка backup/restore.
