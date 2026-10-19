# holiday-quiz-engine

White-label движок праздничных игр для бизнеса на Next.js 16, React 19, TypeScript, PostgreSQL и Prisma. Один движок — много квизов: каждый клиент — это пакет данных `tenants/<slug>/` (бренд, сюжет, герои, задания, призы, юридические тексты), а механика, сервер и проверки общие.

Что умеет движок:

- **Квиз** (`mode: "cards"`) — карта и полноэкранные комнаты с заданиями;
- **Квест** (`mode: "quest"`, по умолчанию) — мир-иллюстрация, по которому ходит персонаж, помогает героям и зажигает зоны;
- **Адвент-календарь** «N дней до Нового года» — в разработке: схема, домен, серверные API и вход по ссылке готовы, клиентский интерфейс пока заглушка (`docs/engine/ADVENT_PLAN.md`).

В квизе и квесте участник проходит 3–6 зон по 2–4 задания (пять типов: `pick`, `build`, `phish`, `access`, `order`), затем 30-секундный финальный рывок и получает один из уровней наград. Очки, комбо, бонусы и дедлайны считаются только сервером по серверным отметкам времени, призовая заявка подтверждается по email. Правила — в [`docs/game/MECHANICS.md`](docs/game/MECHANICS.md).

Пакеты собирает агент (Claude Code или Codex) по брифу клиента: скилл [`.claude/skills/build-quiz/SKILL.md`](.claude/skills/build-quiz/SKILL.md) и команды `npm run quiz:*`. Агент заполняет данные, а не пишет код; ошибки ловит `quiz:check`. Инструкции и архитектурные ограничения для coding-агентов — в `CLAUDE.md` и `AGENTS.md`.

## Быстрый старт

Требуются Node.js 22, PostgreSQL и SMTP (локально подойдёт Mailpit).

```bash
npm ci
cp .env.example .env      # задайте секреты
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Приложение откроется на `http://localhost:3000`. Без `TENANT` локально выбирается первый пакет из `tenants/index.ts`; другой пакет — `TENANT=<slug> npm run dev`.

Весь контур в Docker:

```bash
docker compose up --build
```

Отдельный контейнер сначала применит миграции и seed; Mailpit (письма с подтверждением) — на `http://localhost:8025`.

`QUIZ_FORCE_OPEN=true` открывает старт игры, окна заявки и подтверждения вне дат кампании и разрешён только вне production. В Compose сборка работает как production, поэтому там его разрешает явный маркер `QUIZ_LOCAL_STACK=true`, и только если `APP_URL` указывает на loopback-адрес (`localhost`, `127.0.0.1`, `::1`); с публичным `APP_URL` приложение не стартует. В production тот же Docker target `migrate` запускается как одноразовая job перед переключением трафика.

## Проверки

```bash
npm test                     # unit- и компонентные тесты, БД не нужна
npm run lint
npx tsc --noEmit
DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run build
npm run quiz:check -- --all  # все пакеты: схема, длины строк, мир, контраст, симуляция
TEST_DATABASE_URL=postgresql://quiz:quiz-local-only@127.0.0.1:5432/quiz_test npm run test:integration
npm run test:e2e             # Playwright на пакете demo-office
npm run test:e2e:tenants     # E2E по очереди на всех пакетах (так гоняет CI)
```

### Интеграционные тесты (реальный PostgreSQL)

Набор `tests/integration/` проверяет Prisma-репозитории и route handlers на настоящем PostgreSQL; SMTP подменяется фейком через `overrideServices`.

Поднять тестовую БД — любой из вариантов:

```bash
# Docker
docker run -d --name quiz-test-db -e POSTGRES_USER=quiz -e POSTGRES_PASSWORD=quiz-local-only \
  -e POSTGRES_DB=quiz_test -p 5432:5432 postgres:17-alpine

# или локальный PostgreSQL (Debian/Ubuntu)
sudo apt-get install -y postgresql
sudo -u postgres psql -c "CREATE ROLE quiz LOGIN SUPERUSER PASSWORD 'quiz-local-only'" -c "CREATE DATABASE quiz_test OWNER quiz"
```

- Перед прогоном автоматически выполняются `prisma generate` (если клиента нет) и `prisma migrate deploy`; между тестами все таблицы схемы очищаются через `TRUNCATE ... CASCADE`.
- Параметр `schema` в `TEST_DATABASE_URL` учитывается миграциями, приложением и очисткой; по умолчанию — `public`.
- Имя базы должно начинаться с `test_` или оканчиваться на `_test` — иначе прогон откажется стартовать, чтобы не стереть рабочие данные.
- Без `TEST_DATABASE_URL` набор явно пропускается с сообщением (код возврата 0).
- Файлы выполняются последовательно: они делят одну БД.
- Лимитеры запросов сбрасываются и настраиваются в тестах (`publicApiRateLimiter.reset()` / `setLimit()`, `sessionCreationRateLimiter.reset()`), часы и отправка писем подменяются через `overrideServices` из `src/server/container.ts`.
- Любой тест падает, если в `console.*` попали email, токен, поля формы или пароль администратора (`tests/integration/setup.ts`).

### E2E

Для локального запуска поднимите PostgreSQL на `127.0.0.1:5432` и Mailpit на `127.0.0.1:1025` (веб-интерфейс и API — `:8025`), примените миграции и seed (`docker compose up -d db mailpit` порты БД и SMTP не публикует).

```bash
npm run test:e2e                              # desktop-chromium и mobile-chromium, пакет demo-office
E2E_BROWSER_CHANNEL="" npm run test:e2e       # встроенный Chromium вместо установленного Chrome
E2E_TENANT=demo-coffee npm run test:e2e       # другой пакет: тексты и селекторы берутся из него
E2E_TENANTS="demo-office,demo-coffee" npm run test:e2e:tenants
E2E_SERVER=prod npm run test:e2e              # production-сборка + standalone server.js
E2E_SERVER=prod E2E_SKIP_BUILD=1 npm run test:e2e
```

По умолчанию Playwright запускает `npm run dev` с `QUIZ_FORCE_OPEN=true`. `E2E_SERVER=prod` собирает приложение и запускает тот же standalone `server.js`, что и Dockerfile (`scripts/e2e-prod-server.mjs` копирует `.next/static` и `public` в `.next/standalone`), и сам ставит `QUIZ_LOCAL_STACK=true`. `E2E_BROWSER_EXECUTABLE` задаёт путь к браузеру, `MAILPIT_URL` — адрес API Mailpit (по умолчанию `http://127.0.0.1:8025`). Тестовые значения окружения — в `tests/e2e/support/env.ts`; `DATABASE_URL`, `APP_URL`, `SMTP_*` и учётные данные администратора переопределяются одноимёнными переменными. Специальных хуков для E2E в приложении нет: рывок проходится до исчерпания пула или ожиданием 30 секунд.

### CI

Workflow `.github/workflows/ci.yml` запускается на push в `main` и на каждый PR:

- `checks` — `npm ci`, `lint`, `npm test`, `build`;
- `e2e` — PostgreSQL и Mailpit как service containers, миграции и seed, сборка, Playwright против production-сборки (`E2E_SERVER=prod`); отчёт и trace при падении сохраняются артефактами;
- `docker` — `docker compose build`, `up -d`, ожидание `/api/ready`, `npm run test:load` с `LOAD_TEST_CONCURRENCY=25`, `down`.

## Карта проекта

- `src/config/` — схемы и контракт: `schema.ts` (кампания квиза и квеста), `pack.ts` (пакет арендатора), `brand.ts` (бренд, история, тексты интерфейса), `legal.ts` (юридические тексты и маркер `LEGAL_PLACEHOLDER`), `advent-schema.ts`, `theme.ts` (дизайн-токены), `icon-paths.ts` (словарь иконок).
- `src/domain/` — чистые правила: `tasks.ts` (разбор ответов), `scoring.ts` (очки, комбо, бонусы, уровни, `maxScore`), `rush.ts` (дедлайн рывка), `advent/`, `errors.ts` (`DomainError`).
- `src/server/` — сервер: `services/` (сессии, рывок, заявки, адвент, вход по ссылке), `repositories/` (PostgreSQL и in-memory), `tenants.ts` (реестр и выбор арендатора), `presentation.ts` (публичное представление без ответов), `launch-checks.ts`, гейты staging и админки, лимиты, почта.
- `src/components/` — интерфейс: `game/` (режим cards), `quest/` (режим quest), `play/` (общий слой обоих режимов: загрузка сессии, поток комнаты, механики заданий, звук), `advent/`.
- `src/app/` — страницы (`/`, `/admin`, `/privacy`, `/share/[sessionId]`, `/verify`, `/login`, `/quest`) и `api/` (публичные и операторские API).
- `src/worlds/` — схема, загрузчик и расчётная модель миров.
- `worlds/<id>/world.json` — разметка миров; `worlds/index.ts` — манифест.
- `tenants/<slug>/` — пакеты арендаторов; `tenants/index.ts` — манифест пакетов, собранных в образ.
- `profiles/` — пресеты типов бизнеса для адвента (`retail`, `horeca`, `beauty`, `b2b`, `corporate`).
- `prisma/` — `schema.prisma`, миграции, `seed.ts`.
- `scripts/` — CLI `quiz:*`, `select-packs.mjs`, очистка ПДн, нагрузочный smoke, скриншоты.
- `deploy/` — выкатка на ВМ (Compose, Caddy, бэкапы); runbook — `deploy/README.md`.
- `public/` — статика: `worlds/<id>/` (иллюстрации миров), `art/` (фон картинки «Поделиться»), `fonts/`, `audio/`.
- `tests/` — `unit/`, `components/`, `integration/`, `e2e/`, `fixtures/` (в том числе второй мир-фикстура `worlds/ring.json`), `support/`.
- `docs/` — `game/MECHANICS.md` (правила игры), `engine/ENGINE_PLAN.md` и `engine/ADVENT_PLAN.md` (архитектура и планы), `brief-template.md` и `examples/` (бриф клиента).

## Пакеты в репозитории

| Пакет | Режим | Что это |
|---|---|---|
| `tenants/demo-office` | `quest` | Эталонный пакет квеста: вымышленная компания «Северный офис» в мире `snow-globe`. Пять зон (Почтовая, Зал совещаний, Лаунж, Бухгалтерия, Штаб ярмарки) по три задания, все пять типов заданий, пролог, финальный рывок и четыре уровня наград. Регрессионная база движка: на нём держатся unit-, интеграционные и E2E-тесты. TS-модули `campaign.ts`, `legal.ts`, `pack.ts`. |
| `tenants/demo-coffee` | `cards` | Демо режима карточек: кофейня «Зерно», три зоны. Собран агентом по брифу `docs/examples/brief-demo-coffee.md`; формат `pack.json`. |

Все компании, люди и факты в демо-пакетах вымышлены.

### Мир `snow-globe`

Единственный мир в библиотеке: офис внутри снежного шара с пятью точками зон (`mail`, `calendar`, `messenger`, `files`, `projects`), ёлкой, площадкой рывка и робот-помощником. Разметка — `worlds/snow-globe/world.json` (граф дорожек, точки зон, места игрушек на ёлке, рамки камеры, огни, иллюстрации зон); картинки — `public/worlds/snow-globe/` (WebP), кадр для картинки «Поделиться» — `public/art/og-hero.jpg` (Satori не рисует WebP). Снег и мерцание огней — отдельные CSS-слои с поддержкой `prefers-reduced-motion`.

## Сборка пакетов (`npm run quiz:*`)

Команды одинаковы для Claude Code и Codex; агент работает через них, а не правит код механики. Аргументы передаются после `--`.

| Команда | Что делает |
|---|---|
| `npm run quiz:new -- <slug> [--brief brief.md] [--zones 3]` | Создаёт `tenants/<slug>/pack.json` (все тексты «TODO: …»), переносит поля брифа (`docs/brief-template.md`), регистрирует пакет в `tenants/index.ts` |
| `npm run quiz:check -- <slug>` или `--all` | Схема, маркеры TODO, длины строк под вёрстку, файлы логотипа и фона, мир и режим, контраст, симуляция на настоящих сервисах (идеальный проход должен дать `maxScore` и высший уровень, нулевой — нижний). Код возврата 1 при ошибках |
| `npm run quiz:brand -- <slug> <url> [--apply]` | Playwright снимает сайт клиента: цвета, шрифт, favicon, og:image, логотип; печатает предложение для `brand`, с `--apply` пишет `brand.colors`/`brand.font` в `pack.json`. Картинки скачивает человек или агент в `public/tenants/<slug>/` |
| `npm run quiz:shots -- <slug> [каталог]` | Скриншоты лендинга, первого задания, карты, рывка, финала, «Поделиться», `/privacy` (mobile + desktop) в `shots/<slug>`. Нужен запущенный сервер: `TENANT=<slug> QUIZ_FORCE_OPEN=true npm run dev` |
| `npm run quiz:preview -- <slug> --base-domain D [--ssh U@H --deploy]` | Превью на общем сервере: проверка пакета и git, выкатка через `deploy/deploy.sh`, адрес `https://<slug>.D/` за staging-паролем |
| `npm run quiz:export -- <slug> --domain D [--build]` | Папка для сервера клиента: `.env` с секретами (`TENANT`, `QUIZ_PACKS`), инструкция, с `--build` — образы только с пакетом клиента |
| `npm run quiz:admin -- <slug> --user ops` | Логин оператора клиента (пароль печатается один раз, в БД — хеш scrypt); `--disable`, `--list` |

Картинки пакета (логотип, фон «Поделиться») лежат в `public/tenants/<slug>/`, в пакете на них ссылаются путём `/tenants/<slug>/…`.

## Как добавить приватный пакет клиента

Пакеты реальных клиентов не должны попадать в публичный репозиторий. Рекомендуемая схема — держать их в отдельном приватном репозитории и копировать в `tenants/` при сборке.

1. Положите папку пакета в `tenants/<slug>/` в одном из двух форматов:
   - TS-модули, как в `demo-office`: `campaign.ts` (кампания, разбирается `campaignSchema`), `legal.ts` (юридические тексты), `pack.ts` (паспорт: `tenant`, `hosts`, `worldId`, `campaign`, разбирается `packSchema`);
   - один `pack.json`, как в `demo-coffee` (так его создаёт `quiz:new`).
2. Зарегистрируйте пакет в `tenants/index.ts`: импорт — у маркера `// quiz:new-import`, элемент массива `packs` — у маркера `// quiz:new-append`:

   ```ts
   import { pack as clientX } from "./client-x/pack";                     // TS-модули
   import clientY from "./client-y/pack.json" with { type: "json" };      // pack.json
   // quiz:new-import
   …
   export const packs: unknown[] = [
     demoOffice,
     demoCoffee,
     clientX,
     clientY,
     // quiz:new-append
   ];
   ```

   `quiz:new` делает это сам. Картинки пакета — в `public/tenants/<slug>/`.
3. Проверьте: `npm run quiz:check -- <slug>`.
4. Соберите образ только с нужными пакетами: build-аргумент `QUIZ_PACKS=<slug>[,<slug>]` запускает `scripts/select-packs.mjs`, который на копии исходников внутри сборки оставляет в манифесте только выбранные пакеты и удаляет каталоги остальных (`tenants/<slug>`, `public/tenants/<slug>`). Так демо и чужие клиенты не попадают в боевой образ.

   ```bash
   docker build --build-arg QUIZ_PACKS=client-x --build-arg APP_VERSION=$(git rev-parse --short HEAD) .
   ```

5. Запускайте с `TENANT=<slug>`.

## Арендаторы и конфигурация

Пакет проверяет `packSchema` (`src/config/pack.ts`), кампанию — `campaignSchema` (`src/config/schema.ts`). Реестр `src/server/tenants.ts` проверяет все пакеты при старте и выбирает арендатора: `TENANT=<slug>` из окружения → точный `Host` из `hosts` пакета → поддомен `<slug>.$TENANT_BASE_DOMAIN` → первый пакет (вне production или если пакет единственный). В production с несколькими пакетами нужно задать `TENANT`, иначе процесс не стартует. Данные разных кампаний разделены полем `campaignSlug` (уникальность заявки — `[campaignSlug, normalizedEmail]`), сессия чужого арендатора отвечает «не найдено».

Бренд, история и тексты интерфейса — в `campaign.brand`, `campaign.story`, `campaign.copy` (схемы — `src/config/brand.ts`): имя и логотип, 8 цветов палитры (+ необязательные производные `brand.derived`), шрифт из allowlist (`onest`, `inter`, `manrope`, `montserrat`, `nunito`, `rubik`; подключены в `src/app/fonts.ts`), фон картинки «Поделиться», тема письма, заголовок мира, реплика гида, подписи итоговой карточки и тексты метафоры (`copy` с дефолтами «игрушки на ёлку»). Палитру в `<style id="brand-theme">` отдаёт `layout.tsx` (`src/config/theme.ts`), стили используют `var(--…)`; схема проверяет контраст WCAG для основных пар текст/фон. В CSS нет захардкоженных цветов бренда (кроме запасного `:root` в `globals.css`) — это проверяет `tests/unit/brand-css.test.ts`. Realm Basic auth берётся из `brand.name`. Подписи сцены (дата на лендинге, часы на заставке рывка) — `campaign.scene`.

Мир выбирает пакет (`worldId`). Схема и проверки мира (ссылки, связность графа, достижимость площадок) — `src/worlds/world.ts`, загрузчик — `src/worlds/registry.ts`, расчётная модель — `src/worlds/model.ts`. Зона пакета ссылается на точку мира через `spotId` (по умолчанию — id зоны), герой-хозяин зоны — `hostId`; привязку проверяют `quiz:check` и старт приложения. Тесты гоняют второй мир-фикстуру (`tests/fixtures/worlds/ring.json`). Редактор новых миров пока не сделан.

Диапазоны: зоны 3–6, заданий в зоне 2–4, героев 1–8, уровней наград 2–5, кнопок рывка 3–6 (их id совпадают с id зон). Порог уровня — `minScore` в очках или `minPercent` от максимума кампании. Схема проверяет целостность контента: уникальные id, верные ответы каждого типа задания, число слотов сборки, перестановку порядка, размер и состав пула рывка, нейтральность id вариантов, имена иконок. Механика сессий и подсчёт от контента пакета не зависят.

### Переменные окружения

Полный список с комментариями — `.env.example`. Основные:

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | PostgreSQL |
| `APP_URL` | Публичный адрес приложения (ссылки в письмах, проверка `Origin`) |
| `TENANT` | Пакет арендатора; пусто — выбор по `Host` |
| `TENANT_BASE_DOMAIN` | Общий домен для адресов вида `<slug>.<домен>` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, `SMTP_USER`/`SMTP_PASSWORD` | Почта (авторизация необязательна, обе переменные вместе) |
| `REWARD_QR_SECRET` | Подпись личного QR для погашения наград адвента на кассе (≥ 32 символов, `openssl rand -hex 32`); в production обязательна, если есть награды `redeem: cashier/both` |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Суперадминистратор (пароль ≥ 16 символов); действует при `TENANT=<slug>` или `SUPERADMIN=true` |
| `STAGING_USERNAME`, `STAGING_PASSWORD` | Закрытый стенд: HTTP Basic auth на весь сайт |
| `QUIZ_FORCE_OPEN`, `QUIZ_LOCAL_STACK` | Открыть кампанию вне дат (см. «Быстрый старт») |
| `QUEST_PROTOTYPE` | Открыть превью `/quest` в production |
| `APP_VERSION` | Ревизия сборки для `/api/health` (build-аргумент образа) |
| `TEST_DATABASE_URL` | Только для `npm run test:integration` |

Закрытый стенд (`STAGING_*`) закрывает весь сайт, кроме `/api/health`, хешированной статики `/_next/static/*`, `/admin` и `/api/admin/*` (у них своя авторизация); при нём в production разрешён `QUIZ_FORCE_OPEN`. Превью ссылок «Поделиться» в мессенджерах на staging не работают: краулер получает 401.

## Режимы игры

`campaign.mode`: `quest` (по умолчанию) — мир-иллюстрация, по которому ходит персонаж; `cards` — карта и полноэкранные комнаты. Параметр `/?mode=cards` или `/?mode=quest` переключает подачу для показа и тестов; сессия, ключи `localStorage` и очки общие. Звук квеста выключен по умолчанию (кнопка в HUD, выбор хранится в `localStorage`). Управление в квесте: тап или клик по точке мира, стрелки или WASD, Enter/пробел рядом с героем; «Список комнат» переносит к герою без ходьбы. При `prefers-reduced-motion` персонаж перемещается мгновенно, снег и огни статичны.

Страница `/quest` — превью режима квеста поверх того же API: вне production открыта всегда, в production — только при `QUEST_PROTOTYPE=true` или в локальном контуре с `QUIZ_FORCE_OPEN`, иначе `404`.

## API игры

Все пути — под `/api/sessions`, типы — в `src/types/api.ts`. Каждый запрос, кроме создания сессии, требует cookie `quiz_session_access` (иначе `401`); изменяющие запросы требуют заголовок `Origin` приложения (иначе `403`). Ошибки — `{ "error": "<русский текст>" }`: `400` неверный запрос или истёкший рывок, `404` не найдено, `409` нарушен порядок игры, `429` лимит запросов.

| Метод и путь | Тело | Ответ |
|---|---|---|
| `POST /api/sessions` | — | `{ sessionId, campaign, session }`; ставит cookie |
| `GET /api/sessions/:id` | — | `{ campaign, session }` — всё для восстановления игры |
| `POST /api/sessions/:id/rooms/:roomId/enter` | — | `{ room }`; идемпотентно, время входа фиксируется один раз |
| `GET /api/sessions/:id/rooms/:roomId/task` | — | `{ room, task, taskNumber }`; `task` — публичное задание без признаков правильности с перемешанными вариантами, `null` у пройденной комнаты; до входа `409`; первая выдача фиксирует время для бонуса скорости; `?taskId=<id>` возвращает уже отвеченное задание (для разбора после перезагрузки), для неотвеченного `409` |
| `POST /api/sessions/:id/answers` | `{ taskId, payload }` | `{ reveal, score, room, roomResult, nextTaskId }`; идемпотентно, повтор возвращает первый разбор |
| `POST /api/sessions/:id/rush/start` | — | `{ rush, score }`; после всех зон, идемпотентно |
| `POST /api/sessions/:id/rush/answer` | `{ itemId, serviceId }` | `{ correct, scoreDelta, score, rush }`; `itemId` — только текущая заявка из `rush.current` |
| `POST /api/sessions/:id/rush/finish` | — | `{ rush, score }`; идемпотентно |
| `POST /api/sessions/:id/complete` | — | `{ score, rewardTierTitle, final }`; нужны все ответы и завершённый (или истёкший) рывок; идемпотентно |
| `POST /api/sessions/:id/claim` | `{ name, email, company, consent }` | заявка на приз; доступно после `complete`, письмо со ссылкой подтверждения |

`payload` по типу задания: `pick`, `phish` — `{ optionId }`; `build` — `{ optionIds }` ровно из `slots` карточек; `access` — `{ enabledIds }`; `order` — `{ orderedIds }` со всеми карточками. Правильные ответы, `explanation`, `tip`, `thanks` и `oops` неотвеченных заданий клиенту не отдаются: они приходят в `reveal` после ответа и затем в `session.answers`. Клиентские таймеры нужны только для показа: решения принимает сервер. Клиент хранит в `localStorage` только id сессии, cookie доступа ставит сервер; после перезагрузки экран определяется по `GET /api/sessions/:id`.

API адвента — под `/api/advent/` (см. `docs/engine/ADVENT_PLAN.md`).

## Операторский доступ

За reverse proxy с HTTPS:

- `GET /admin` — панель оператора: воронка (сессии → зоны → рывок → игра → заявка → подтверждение → выгрузка) с разбивкой по дням (МСК), доля верных по каждому заданию, распределение по уровням, среднее и медианное время прохождения, таблица заявок с маской email (`a***@domain.ru`) и кнопка выгрузки CSV. Только SQL-агрегаты, полный email виден лишь в CSV. Доступ — строго в рамках арендатора по `Host`: логины `TenantAdmin` (`npm run quiz:admin`) или `ADMIN_*` при `TENANT`/`SUPERADMIN=true`; staging-пароль здесь не действует;
- `GET /api/admin/metrics` — старты, завершения, подтверждённые заявки и ошибки отправки писем;
- `GET /api/admin/claims.csv` — подтверждённые заявки (включая выгруженные); статус не меняет;
- `POST /api/admin/claims/export` — отметка «выгружено» (`exported`); требует авторизацию и same-origin (`Origin` = `APP_URL`, `Sec-Fetch-Site` не cross-site), иначе 403;
- `GET /api/health` — liveness; `version` — ревизия сборки (`APP_VERSION`, по умолчанию `dev`);
- `GET /api/ready` — проверка подключения к БД.

Email, токены подтверждения и поля формы не журналируются.

## Публичные страницы

- `/privacy` — политика обработки данных из `campaign.legal` (`operatorName`, `policyText`, `consentText`); форма заявки показывает `consentText` со ссылкой на `/privacy`.
- `/share/[sessionId]` — результат для «Поделиться» с Open Graph/Twitter-метатегами и кнопкой «Сыграть самому»; `/share/[sessionId]/image` — картинка 1200×630 (`next/og`). Данные только из завершённой сессии (счёт, уровень, название кампании), для незавершённой или неизвестной — 404. Шрифт Onest (OFL) — в `public/fonts/`. Готовые PNG кешируются в памяти (LRU на 500 сессий), на `/share/*` действует лимит 60 запросов в минуту на IP (429).
- `/robots.txt`: в production индексируются только `/` и `/share/*`; при заданных `STAGING_*` — `Disallow: /`.

## Эксплуатация

- Перед развёртыванием: `npm test`, `npm run lint`, `npm run test:integration`, `npm run quiz:check -- --all`, `npm run build`, затем `npm run db:migrate` и `npm run db:seed`.
- Удаление персональных данных: `CONFIRM_PII_DELETION=DELETE_QUIZ_PII npm run cleanup:pii`, граница — `PII_CREATED_BEFORE`. На ВМ используйте `deploy/cleanup-pii.sh`, где граница обязательна. Тот же скрипт чистит адвент: удаляет использованные и просроченные ссылки входа, а через `ADVENT_PII_RETENTION_DAYS` суток (по умолчанию 30) после `claimEndsAt` стирает email и согласия участников; прогресс остаётся обезличенным.
- Rate limit: общий — 3000 запросов в минуту на ключ клиента, на создание сессии — 60 в минуту. Лимиты хранятся в памяти процесса и рассчитаны на один экземпляр; при горизонтальном масштабировании их нужно перенести в Redis или gateway.
- Нагрузочный smoke: `npm run test:load` (по умолчанию 25 параллельных полных сессий); адрес и нагрузка — `LOAD_TEST_URL` и `LOAD_TEST_CONCURRENCY` (от 1 до 60: с одного адреса большее число упрётся в лимит создания сессий).

## Выкатка

Боевая выкатка на облачную ВМ (любой провайдер в РФ): Docker Compose, Caddy с Let's Encrypt и on-demand TLS для доменов клиентов, PostgreSQL, бэкапы, режимы staging/production, общий сервер превью и сервер клиента — в [`deploy/README.md`](deploy/README.md).

## Перед production-запуском

Движок не запустит production, пока не закрыты блокеры конкретной кампании:

- тексты заданий и пула рывка утверждены клиентом и экспертом, подарки и уровни утверждены;
- юридические тексты (`legal`: оператор персональных данных, политика, согласие) утверждены юристом клиента. Пока в них стоит маркер `LEGAL_PLACEHOLDER` («[ТЕКСТ НА СОГЛАСОВАНИИ ЮРИСТА]», `src/config/legal.ts`), production-процесс не стартует (`src/server/launch-checks.ts`); на staging и в локальном контуре маркер допустим;
- настроены production URL, TLS и SMTP (письмо подтверждения доходит);
- заданы production-секреты (`ADMIN_*`, SMTP, БД), секреты не попадают в git;
- проверено восстановление из резервной копии (backup/restore).
