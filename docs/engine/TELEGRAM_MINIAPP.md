# Адвент как Telegram Mini App

Прототип для показа на продажах: демо-кофейня `demo-coffee-advent` открывается внутри Telegram по ссылке из канала, игрок входит без email, интерфейс подстраивается под окно Telegram. Напоминания сообщениями бота в этот этап **не входят** (см. «Что дальше»).

Официальная документация: <https://core.telegram.org/bots/webapps>.

## 1. Как это устроено

- **Один бот — много клиентов.** У бота может быть много мини-приложений (BotFather `/newapp`); у каждого свой URL. Клиент = свой app short name с URL домена арендатора. Арендатор резолвится по `Host`, как и без Telegram. Клиент может завести и свой бот: токен задаётся отдельно (раздел 3).
- **Скрипт Telegram грузится только в Telegram.** `https://telegram.org/js/telegram-web-app.js` подключается, когда в hash адреса есть `tgWebAppData`/`tgWebAppPlatform` (или `?platform=telegram`) и кампания включила Telegram. Обычный веб никаких сторонних запросов не делает.
- **Вход без cookie.** В Telegram Web (web.telegram.org) мини-приложение открывается во фрейме, и сторонние cookie там часто блокируются. Поэтому клиент шлёт в каждом запросе к `/api/advent/*` заголовок `X-Telegram-Init-Data: <initData>`, а сервер сам проверяет подпись.
- **Идентичность.** Таблица `ParticipantIdentity (campaignSlug, platform, subjectHash, participantId)`. `subjectHash` — HMAC-SHA256 от `telegram:<кампания>:<id пользователя>` с серверным секретом `PLATFORM_ID_SECRET`. Сырой Telegram ID, имя, username и фото **не хранятся** и в логи не пишутся. Уникальный индекс гарантирует «один аккаунт — один участник» даже при двух параллельных первых запросах. Участник с платформенной идентичностью считается подтверждённым для наград: коды и удача выдаются без email, антифарм держится на уникальности аккаунта.
- **Согласие.** При первом открытии показывается экран согласия (текст — `legal.telegramConsentText`, иначе `legal.consentText`, плюс пояснение про псевдонимизированный идентификатор). Участник создаётся только после «Начать», `consentAt` пишет сервер. Без согласия участника нет (ответ 409).
- **Родной вид.** `ready()`, `expand()`, цвета шапки и фона Telegram = `--bg` бренда (не тема Telegram), отступы safe area из `--tg-safe-area-inset-*` и `--tg-content-safe-area-inset-*` (по умолчанию 0), высота `--tg-viewport-stable-height`, BackButton закрывает лист дня/серии, тактильный отклик на открытие окна, удачу, подарок и копирование промокода. Копирование кода: `navigator.clipboard`, затем `execCommand("copy")`, затем выделение текста для ручного копирования. Блоки «Сохранить прогресс» (email) и email-напоминания в Telegram скрыты.

### Проверка initData

Сервер (`src/platform/telegram-init-data.ts`, `verifyTelegramInitData`) делает то, что описано в документации: все поля, кроме `hash`, сортируются по ключу, склеиваются `key=value` через `\n`; `secret_key = HMAC_SHA256("WebAppData", токен бота)`; `hash` сравнивается за постоянное время (`timingSafeEqual`). Поле `signature` (Ed25519 для третьих сторон) в проверке HMAC — обычное поле и входит в строку. Срок: `auth_date` не старше `TELEGRAM_INIT_DATA_MAX_AGE` секунд (по умолчанию 86400) и не из будущего (запас на часы — минута). `initDataUnsafe` на сервере не используется. Невалидный заголовок — 401 **без отката на cookie**; арендатор без `platforms.telegram` заголовок отвергает.

### Origin и фрейм

- **Проверка Origin остаётся прежней.** Страница открывается с нашего домена (в WebView или во фрейме Telegram Web), поэтому её `fetch` — обычный same-origin запрос: `Origin` совпадает с `Host` арендатора, проверка `isOriginAllowedForRequest` проходит. Валидный initData обход проверки Origin **не даёт**: заголовок нельзя отправить с чужой страницы без CORS, а подпись защищает только личность, не источник запроса.
- **Фрейм.** Раньше все страницы отдавались с `X-Frame-Options: DENY`, и Telegram Web не смог бы открыть мини-приложение. Теперь `src/proxy.ts` (`src/server/frame-policy.ts`) для адвента с включённым Telegram отдаёт `Content-Security-Policy: frame-ancestors 'self' https://web.telegram.org https://webk.telegram.org https://webz.telegram.org https://k.web.telegram.org https://z.web.telegram.org` без `X-Frame-Options`; для всего остального и для `/admin`, `/api`, `/redeem` — `frame-ancestors 'none'` и `X-Frame-Options: DENY`. Caddy ставит `frame-ancestors 'none'` только как значение по умолчанию (`?Content-Security-Policy`).
- Остальной CSP в проекте нет, сторонний скрипт `telegram.org` ничем не блокируется.

### Параметр запуска (`startapp`)

Допустимы только `A-Za-z0-9_-`, до 512 символов (`src/platform/start-param.ts`). Наш формат:

| Параметр | Что делает |
| --- | --- |
| `d6` | открыть день 6, если он доступен (сегодня, можно догнать или уже открыт), иначе остаться на фасаде |
| `s_channel` | метка источника «channel» |
| `d6_s_channel` | то и другое |

Метка источника: латиница в нижнем регистре, цифры, дефис, до 24 символов. Сервер читает её из **подписанного** `start_param` (`POST /api/advent/platform/visit`) и прибавляет счётчик «кампания × источник × день (UTC)» (`AdventSourceVisit`) — без участников и персональных данных. Новых меток сверх 40 на кампанию считаются как `other` (метку может придумать любой по ссылке). В админке адвента: блок «Ссылки для поста (Telegram)» — ссылка на мини-приложение, текст поста-заглушка, ссылки на каждый день с кнопкой «Скопировать» и таблица переходов по источникам. «Поделиться» в финале в Telegram открывает окно пересылки со ссылкой на мини-приложение (метка `s_share`).

## 2. Что сделать владельцу в Telegram

1. **Создать бота.** В [@BotFather](https://t.me/BotFather): `/newbot`, имя и username (должен оканчиваться на `bot`). Токен — секрет: в репозиторий, чат и логи не попадает.
2. **Создать мини-приложение на клиента.** `/newapp` → выбрать бота → название, описание, картинка 640×360 (можно пропустить `/empty`), **Web App URL** = `https://<домен арендатора>/` (HTTPS обязателен), **short name** (латиница, цифры, `_`, 3–30 символов; он станет частью ссылки). Получится `https://t.me/<бот>/<short_name>`.
3. **Прописать имена в пакете** `tenants/<slug>/pack.json`:
   ```json
   "platforms": { "telegram": { "botUsername": "my_advent_bot", "appShortName": "advent" } }
   ```
   (в демо-пакете сейчас имена-заглушки `zerno_advent_demo_bot` / `advent`, подставьте реальные). Имена — не секреты, пакет в Git хранить можно. `npm run quiz:check -- <slug>` проверит формат и предупредит, если в окружении нет токена и `PLATFORM_ID_SECRET`.
4. **Положить секреты в окружение сервера** (раздел 3).
5. **Кнопка меню и Main Mini App (по желанию).** `/mybots` → бот → *Bot Settings* → *Menu Button* → URL приложения; *Main Mini App* — запуск по кнопке «Открыть» в профиле бота и ссылке `https://t.me/<бот>?startapp`.
6. **Пост в канале.** Админка адвента → «Ссылки для поста»: скопировать ссылку (`https://t.me/<бот>/<short_name>?startapp=d6_s_channel`) и вставить в пост или кнопку-ссылку. Полноэкранный режим — по умолчанию; `&mode=compact` открывает половину экрана.

## 3. Переменные окружения

| Переменная | Назначение |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | токен бота по умолчанию |
| `TELEGRAM_BOT_TOKEN__<ИМЯ_БОТА>` | токен своего бота клиента; имя заглавными (`TELEGRAM_BOT_TOKEN__MY_ADVENT_BOT`), важнее общего. В `deploy/compose.yml` добавьте строку `TELEGRAM_BOT_TOKEN__MY_ADVENT_BOT: ${TELEGRAM_BOT_TOKEN__MY_ADVENT_BOT:-}` в `x-app-env` |
| `PLATFORM_ID_SECRET` | секрет псевдонимизации (≥ 32 символов, `openssl rand -hex 32`). **Менять нельзя**: участники потеряют прогресс. Вне production — ключ разработки |
| `TELEGRAM_INIT_DATA_MAX_AGE` | максимальный возраст `auth_date`, секунд (60…604800, по умолчанию 86400) |

В production с включённым Telegram процесс не стартует без токена бота и `PLATFORM_ID_SECRET` (`assertTelegramSecrets`, `src/instrumentation.ts`); на закрытом стенде и локально требований нет.

## 4. Показать демо без своего сервера

Нужен локальный `npm run dev` и туннель. Закрытый стенд (`STAGING_*`) для этого **не годится**: Telegram не умеет вводить Basic-пароль.

```bash
# 1. База (любой PostgreSQL) и миграции
export DATABASE_URL=postgresql://quiz:quiz@127.0.0.1:5432/quiz
npm ci && npm run db:generate && npm run db:migrate

# 2. Туннель — запомните выданный адрес https://<что-то>.trycloudflare.com
cloudflared tunnel --url http://localhost:3000

# 3. Сервер: TENANT заставляет любой Host (в том числе туннеля) показывать demo-coffee-advent,
#    APP_URL = адрес туннеля (по нему проверяется Origin запросов), токен — от вашего бота.
TENANT=demo-coffee-advent \
APP_URL=https://<что-то>.trycloudflare.com \
TELEGRAM_BOT_TOKEN=<токен бота> \
PLATFORM_ID_SECRET=$(openssl rand -hex 32) \
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Дальше: в BotFather `/newapp` с Web App URL = адрес туннеля, short name как в пакете (`advent`) и именем бота как в пакете (`botUsername` в `pack.json` — свой бот вместо заглушки). Откройте `https://t.me/<бот>/advent` с телефона.

- `*.trycloudflare.com` уже разрешён для `next dev` (`allowedDevOrigins`); другой туннель (ngrok и пр.) — `ALLOWED_DEV_ORIGINS=<хост>`.
- Адрес туннеля меняется при каждом запуске `cloudflared`: после смены обновите Web App URL в BotFather (`/myapps` → приложение → *Edit Web App URL*) и перезапустите сервер с новым `APP_URL`. Для постоянной демонстрации возьмите именованный туннель Cloudflare или поддомен на любом VPS.
- Время демо двигает `?asOf=<ISO>` (для пакетов с `demo: true`). В Telegram параметры адреса задаёт Web App URL, поэтому для показа «как в день 6» можно завести отдельное приложение с URL `https://<туннель>/?asOf=2026-12-25T12:00:00%2B03:00`.
- Без бота вообще: `npm run telegram:shots` и E2E подменяют `window.Telegram.WebApp` фейком с настоящей подписью (раздел 5).

### Тестовая среда Telegram

У Telegram есть отдельный тестовый сервер: свои аккаунты, свой @BotFather и свои боты, данные с боевым не пересекаются; Web App URL там может быть `http://`. Вход в тестовый аккаунт зависит от клиента (по документации: Android и iOS — несколько раз подряд нажать на значок настроек и выбрать добавление аккаунта → Test; Desktop — *Shift+Alt+ПКМ* по «Добавить аккаунт» → Test Server). Точный способ сверьте с разделом «Testing Mini Apps» в [документации](https://core.telegram.org/bots/webapps): на момент написания доступа к ней из среды разработки не было, этот абзац не проверен вживую.

## 5. Проверки

- Юнит: `tests/unit/telegram-init-data.test.ts` (подпись, подмена, перестановка, `signature`, сроки, мусор, `startapp`, ссылки), `telegram-routes.test.ts`, `telegram-pack.test.ts`, `frame-policy.test.ts`; контракт репозиториев `ParticipantIdentity` и счётчиков — `tests/support/advent-repository-contract.ts` (in-memory и PostgreSQL); компонентные — `tests/components/advent-telegram.test.tsx`; интеграция на PostgreSQL (гонка первых запросов, промокод без email) — `tests/integration/advent-telegram.test.ts`.
- E2E: `tests/e2e-advent/telegram.spec.ts` через `page.addInitScript` подменяет `window.Telegram.WebApp` фейком с **настоящим подписанным** initData (тестовый токен из `playwright.advent.config.ts`), скрипт `telegram.org` не загружается: согласие → фасад → день → промокод без email → BackButton, deep link, подделка, обычный веб.
- Скриншоты в имитации Telegram (390×720 с safe area): `npm run telegram:shots -- <каталог>` при запущенном сервере (`docs/screens/telegram-miniapp/`).

## 6. Типичные проблемы

| Симптом | Причина |
| --- | --- |
| Белый экран во фрейме Telegram Web | страница отдаёт `X-Frame-Options`: проверьте, что у арендатора `platforms.telegram` и Caddy стоит версия с `?Content-Security-Policy` (раздел «Origin и фрейм») |
| «Не удалось подтвердить вход через Telegram» | токен не тот бот (initData подписан токеном бота, из которого открыто приложение), срок `auth_date` вышел (закройте и откройте приложение), у арендатора нет токена/`PLATFORM_ID_SECRET` в окружении |
| 403 «Недопустимый источник запроса» | `APP_URL` не совпадает с адресом, по которому открыто приложение (при туннеле — новый адрес) |
| Страница без стилей в `next dev` через туннель | хост туннеля не в `allowedDevOrigins` (`ALLOWED_DEV_ORIGINS`) |
| Ссылка `startapp=d6` ничего не открывает | день ещё закрыт или не наступил: приложение остаётся на фасаде; `?asOf=` в Web App URL сдвигает время демо |
| Экран согласия показывается каждый раз | в окружении другой `PLATFORM_ID_SECRET` (псевдонимы не совпали) или адвент уже закрыт |
| Окно не помещается, перекрыто шапкой Telegram | клиент старше Bot API 8.0 не присылает `--tg-content-safe-area-inset-*`: отступ 0, содержимое всё равно целиком в `--tg-viewport-stable-height` |
| Telegram заблокирован/замедлен у части игроков | мини-приложение и `telegram.org` недоступны без VPN; для клиентов в РФ держите параллельный веб-вход (ссылка на сайт) |

## 7. Что дальше (в этот этап не входило)

- **Напоминания сообщениями бота.** Нужны `requestWriteAccess`/`allows_write_to_pm`, отдельное согласие на рекламу и информационные сообщения (ст. 18 38-ФЗ), хранение `chat id` (ПДн, шифрование, очистка по окончании кампании), отписка кнопкой и командой `/stop`, канал `reminders.channel: "telegram"`, лимиты отправки Bot API (≈30 сообщений/с), обработка блокировки бота пользователем.
- **Связка Telegram-участника с email/веб-участником.** Сейчас вход по email для участника Telegram отвечает 409. Нужны слияние прогресса и наград (по аналогии с `mergeParticipants`), явное подтверждение пользователя и защита от угона через чужой email.
- **MAX и VK.** Слой `src/platform/` рассчитан на новые значения `PlatformKind` и адаптеры: свои правила проверки подписи запуска, свой BackButton/safe area, своя ссылка запуска; `ParticipantIdentity.platform` уже строка.
- **Риски локализации и замедления Telegram.** Хранение и обработка ПДн граждан РФ в РФ (152-ФЗ): `subjectHash` — псевдоним, но согласие и политика должны называть Telegram; замедление/блокировки Telegram в РФ делают мини-приложение недоступным без VPN — веб-вход остаётся основным каналом, Telegram — дополнительным.
- Единая точка `X-Telegram-Init-Data` на каждый запрос — запас по сроку 24 часа; при желании строже — короткий срок и повторное получение initData на клиенте (Bot API ≥ 8.0 не обновляет его без перезапуска приложения).
