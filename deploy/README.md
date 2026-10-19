# Выкатка на облачную ВМ: runbook

Документ рассчитан на человека и на агента, который работает по SSH и опирается только на содержимое git. Подходит облачная ВМ любого провайдера в РФ (или любой сервер с Ubuntu 24.04 и публичным IP). Все команды выполняются на ВМ, если не сказано иное. Секреты в чат и в git не попадают.

## 0. Схема и режимы

```
Интернет :80/:443 -> caddy (TLS Let's Encrypt, HSTS, gzip/zstd) -> app:3000 (Next.js) -> db (PostgreSQL 17)
                                                                  backup (pg_dump раз в сутки -> /opt/quiz/backups)
                                                                  mailpit (только staging, UI на 127.0.0.1:8025)
```

- ВМ: Ubuntu 24.04 LTS, 2 vCPU / 4 ГБ / 40 ГБ SSD, floating IP, один экземпляр приложения (рассчитан на 50-100 одновременных игроков; rate limit хранится в памяти процесса).
- Код клонируется в `/opt/quiz/app`, секреты лежат в `/opt/quiz/.env` (вне git-дерева), дампы — `/opt/quiz/backups`, состояние выкатки — `/opt/quiz/state`.
- Образы собираются на ВМ (registry нет). Порты БД и приложения наружу не публикуются.
- Оператор ПДн — владелец кампании (заказчик квиза), он указан в юридических текстах пакета; данные хранятся на ВМ в РФ (выбирайте регион провайдера на территории РФ).

### Два режима (определяются `.env`)

| | staging (показ до старта кампании) | production (с даты старта) |
|---|---|---|
| Шаблон | `deploy/.env.staging.example` | `deploy/.env.production.example` |
| `STAGING_USERNAME`/`STAGING_PASSWORD` | заданы, сайт закрыт Basic auth | не заданы |
| `QUIZ_FORCE_OPEN` | `true` (квиз открыт вне дат кампании) | `false` |
| `COMPOSE_PROFILES` | `staging` (Mailpit) | пусто |
| SMTP | `mailpit:1025` | настоящий SMTP |

### Два Basic auth

Браузер отправляет один заголовок `Authorization`, поэтому два пароля на один путь не сосуществуют. Разделение по путям (`src/proxy.ts`, `src/server/staging-gate.ts`):

| Путь | staging | production |
|---|---|---|
| `/api/health` | открыт (healthcheck, мониторинг) | открыт |
| `/api/admin/*`, `/admin` (панель оператора) | **не** закрыты staging-паролем, требуют логин оператора арендатора (`quiz:admin`) или `ADMIN_*` при `TENANT`/`SUPERADMIN=true` | то же |
| `/api/internal/tls-ask` (вопрос Caddy о домене, только общий сервер) | открыт, свой секрет `TLS_ASK_TOKEN`; снаружи закрыт в `Caddyfile.shared` | то же |
| `/_next/static/*` (хешированные публичные JS/CSS/шрифты, ответов и ПДн в них нет) | открыт, иначе `/admin` под `ADMIN_*` грузился бы без стилей и скриптов | открыт |
| всё остальное (страницы игры, `/share/*`, `/api/ready`, публичное API, `public/`) | требует `STAGING_*` | открыто |

Превью ссылок в мессенджерах и соцсетях (`/share/*`, картинка) на staging не работают: краулер не знает пароля и получает 401.

В production процесс не стартует, пока в юридических текстах пакета (`tenants/<slug>/legal.ts`, маркер задан в `src/config/legal.ts`) остался маркер «[ТЕКСТ НА СОГЛАСОВАНИИ ЮРИСТА]» (staging и локальный контур его допускают): `/api/health` отвечает 500, выкатка останавливается.

Приложение в production разрешает `QUIZ_FORCE_OPEN=true` только при заданных обоих `STAGING_*` (или в локальном контуре с loopback `APP_URL`). Иначе процесс при старте пишет ошибку, `/api/health` отвечает 500, выкатка останавливается. При staging-старте в лог пишется одно предупреждение `staging_mode_enabled` (без секретов).

## 1. Что нужно от владельца

- Доменное имя (A-запись на floating IP), email для Let's Encrypt.
- Публичный SSH-ключ администратора/агента и его внешний IP (для группы безопасности / файрвола провайдера).
- Доступ к GitHub-репозиторию `<owner>/<repo>` для добавления deploy key.
- Для production: данные SMTP, согласованные тексты/подарки, юридический текст согласия.

## 2. Создание ВМ у облачного провайдера

Подойдёт любой облачный провайдер в РФ; названия пунктов консоли у всех свои.

1. Проект/каталог в регионе на территории РФ. Раздел виртуальных машин -> Создать ВМ.
2. Образ: Ubuntu 24.04 LTS. Конфигурация: 2 vCPU / 4 ГБ RAM. Диск: SSD 40 ГБ.
3. Сеть: сеть с выходом в интернет. Назначить внешний (публичный, floating) IP.
4. Группа безопасности / облачный файрвол (новая): входящие TCP 22 только с IP администратора (`/32`), TCP 80 и TCP 443 (+ UDP 443 для HTTP/3) с `0.0.0.0/0`; исходящие — всё.
5. SSH-ключ: импортировать публичный ключ в консоли провайдера и выбрать при создании. Парольный вход не использовать.
6. Запишите внешний IP. Пользователь по умолчанию в образе Ubuntu обычно `ubuntu`.

## 3. DNS

A-запись `DOMAIN -> floating IP`. Проверка: `dig +short DOMAIN`. Пока запись не распространилась, Let's Encrypt сертификат не выдаст.

## 4. Bootstrap ВМ (один раз)

С рабочего места, из клона репозитория:

```bash
scp deploy/bootstrap-vm.sh ubuntu@<IP>:/tmp/
ssh ubuntu@<IP> 'sudo SSH_ALLOW_FROM=<IP_администратора> bash /tmp/bootstrap-vm.sh'
```

`SSH_ALLOW_FROM` необязателен. Скрипт идемпотентен: обновления, Docker из официального репозитория, пользователь `deploy` (группа docker, ваш SSH-ключ скопирован), отключение паролей SSH, ufw (22/80/443), fail2ban, unattended-upgrades, swap 2 ГБ, Europe/Moscow, каталоги `/opt/quiz`. Далее работаем как `deploy` в новой сессии: `ssh deploy@<IP>`. Проверка: `docker run --rm hello-world`, `sudo`-а у `deploy` нет — это нормально.

Замечание: опубликованные порты Docker обходят ufw; наружу публикуются только 80/443 caddy (Mailpit — на 127.0.0.1).

## 5. Клонирование репозитория (deploy key только на чтение)

На ВМ под `deploy`:

```bash
ssh-keygen -t ed25519 -N "" -C "quiz-vm-deploy" -f ~/.ssh/quiz_deploy
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/quiz_deploy
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
chmod 600 ~/.ssh/config
cat ~/.ssh/quiz_deploy.pub
```

Добавьте публичный ключ в GitHub: репозиторий -> Settings -> Deploy keys -> Add deploy key, **без** галки «Allow write access». Либо с машины с `gh`: `gh repo deploy-key add quiz_deploy.pub --repo <owner>/<repo> --title quiz-vm` (по умолчанию read-only).

```bash
ssh -T git@github.com   # ожидается «successfully authenticated»
git clone git@github.com:<owner>/<repo>.git /opt/quiz/app
```

## 6. Файл `.env`

```bash
cd /opt/quiz/app
deploy/generate-secrets.sh staging \
  --domain quiz.company.ru --email admin@company.ru --smtp-from 'Holiday Quiz <quiz@company.ru>'
```

Создаётся `/opt/quiz/.env` (права 600), секреты — `openssl rand`. `--domain` записывает `DOMAIN=quiz.company.ru` и **`APP_URL=https://quiz.company.ru` одновременно**: скрипты читают `.env` без подстановки `${...}`, поэтому `APP_URL` в файле всегда литерал. Домен позже меняется командой `deploy/generate-secrets.sh --set-domain новый.домен` (обе строки сразу); `validate_env` отказывается работать, если `APP_URL` не равен `https://$DOMAIN`. Ручных `sed` не нужно. Откройте файл, если нужно проверить: `nano /opt/quiz/.env`. Логины/пароли: `grep -E '^(ADMIN|STAGING)_' /opt/quiz/.env` (читайте сами, в чат не вставляйте). Скрипты валидируют файл (`CHANGE_ME_*`, `example.com`, `APP_URL` = `https://DOMAIN`, пароли < 16 символов, согласованность режима) и отказываются работать с ошибками.

Важно: `POSTGRES_PASSWORD` записывается в том БД при первом старте; позже менять только вместе с `ALTER USER` (см. «Типовые проблемы»).

## 7. Первый деплой в staging

```bash
cd /opt/quiz/app
deploy/deploy.sh                 # или: deploy/deploy.sh <ветка|тег|хеш> (по умолчанию origin/main)
```

Шаги: git fetch + checkout (`git checkout --detach`), сборка образов (3-8 минут), дамп перед миграциями, миграции + seed (один раз: при запуске сервисов `migrate` повторно не стартует), запуск, ожидание healthcheck `app`, проверки `https://DOMAIN/api/health`, `/api/ready`, главная должна дать 401 в staging. При провале скрипт печатает `compose ps`, хвосты логов и подсказку; если сбой случился до перезапуска сервисов (сборка, дамп, миграции), работает прежняя версия и откат не нужен; после перезапуска предыдущая версия остаётся в образах `*-app:current` (`deploy/rollback.sh`).

Сертификат выдаётся при первом обращении (до минуты). Если выдача не получается — раздел «Типовые проблемы».

## 8. Проверка staging

```bash
deploy/smoke.sh          # health, ready, закрытость сайта, админка, создание игровой сессии с правильным Origin
deploy/status.sh         # режим, ревизия, контейнеры, дампы, ресурсы
```

Письма (Mailpit): с рабочего места `ssh -L 8025:127.0.0.1:8025 deploy@<IP>`, затем http://localhost:8025. Откройте `https://DOMAIN` в браузере, введите STAGING-логин/пароль, пройдите игру, отправьте заявку, письмо появится в Mailpit.

## 9. Переключение в production (перед стартом кампании)

Чек-лист (выполнять по команде владельца):

1. Тексты заданий и подарки утверждены (`tenants/<slug>/campaign.ts`), юридический текст согласия на обработку ПДн актуален (`tenants/<slug>/legal.ts`, оператор — владелец кампании). Решение по `public/robots.txt` (сейчас `Disallow: /`) принять с владельцем.
2. SMTP: домен отправителя с SPF/DKIM. Проверить доставку **до** переключения: в staging временно прописать настоящий `SMTP_*` (профиль staging можно оставить, Mailpit не будет использоваться), задеплоить, отправить заявку на свой адрес.
3. Бэкап и проверка восстановления: `deploy/backup-now.sh`, затем `deploy/restore.sh latest` (должно закончиться «Дамп пригоден»).
4. Переключить флаги: `deploy/switch-mode.sh production` (профиль staging пуст, `QUIZ_FORCE_OPEN=false`, `STAGING_*` закомментированы). Вписать настоящие `SMTP_HOST/PORT/SECURE/FROM/USER/PASSWORD`.
5. `deploy/deploy.sh`, затем `deploy/smoke.sh` (сайт открыт без пароля, админка 401 без ADMIN, до даты старта кампании `POST /api/sessions` отвечает 403 «закрыт» — это норма). В логах `deploy/logs.sh app` не должно быть `staging_mode_enabled`. Mailpit удаляется скриптом.
6. Время ВМ: `timedatectl` (NTP синхронизирован; окно кампании из пакета проверяет сервер).
7. Подключить мониторинг (раздел 12). Сделать итоговый бэкап.
8. **Очистка тестовых данных staging** (после финального бэкапа из п. 7, ДО п. 4 или сразу после него, но пока режим staging; в боевом режиме скрипт откажется работать): `deploy/reset-staging-data.sh` — покажет число сессий и заявок, снова сделает дамп, потребует слово `ОЧИСТИТЬ` и выполнит `TRUNCATE` игровых таблиц и заявок (схема и таблица `Campaign` сохраняются). Затем проверьте нули: `curl -u "$ADMIN_USERNAME:$ADMIN_PASSWORD" https://DOMAIN/api/admin/metrics` — все счётчики (старты, завершения, заявки, подтверждения) должны быть 0; если нет — переключение отложить. Порядок: итоговый бэкап -> `reset-staging-data.sh` -> `switch-mode.sh production` -> `deploy.sh` -> `smoke.sh` -> повторная проверка метрик (после `smoke.sh` будет одна тестовая сессия — это ожидаемо).

Возврат в staging: `deploy/switch-mode.sh staging` + SMTP на mailpit (`SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_USER`/`SMTP_PASSWORD` пустые) + `deploy/deploy.sh`.

## 10. Обновление и откат

Обновление: `deploy/deploy.sh [ревизия]` (ветка, тег или хеш; по умолчанию `origin/main`). Перед миграциями автоматически делается дамп. Код на ВМ руками не правят: скрипт отказывается работать с изменениями в отслеживаемых файлах.

Если выкатка остановилась до перезапуска сервисов (ошибка сборки, дампа или миграции), прежняя версия продолжает работать: `deploy.sh` не предлагает откат, а `rollback.sh` лишь вернёт код в дереве к работающей ревизии. Откат приложения (после сбоя на запуске или для возврата к прошлой версии): `deploy/rollback.sh`. Возвращает предыдущий образ и ревизию кода без пересборки и без миграций (если последняя выкатка не удалась — к последней успешной; иначе к версии до неё). Повторный запуск возвращает обратно. **БД не откатывается**: миграции аддитивные (новые таблицы/колонки/индексы), старый код работает на новой схеме. Возврат данных из дампа — `restore.sh --full`, теряет всё после дампа, только по решению владельца.

## 11. Бэкапы и восстановление

- Контейнер `backup` делает `pg_dump -Fc` ежедневно в 03:00 МСК (`BACKUP_HOUR_UTC=0`) и при старте, если нет дампа свежее суток. Хранение 14 дней (`BACKUP_RETENTION_DAYS`). Дамп проверяется: не пустой, читается `pg_restore -l`, содержит данные таблиц.
- Внеочередной: `deploy/backup-now.sh`. Список: `ls -lh /opt/quiz/backups`. Забрать себе: `scp deploy@<IP>:/opt/quiz/backups/quiz-<время>.dump .` (резервные копии содержат ПДн — хранить как ПДн).
- Проверка восстановления (безопасно, в отдельную БД `quiz_restore_check`): `deploy/restore.sh latest`.
- Полное восстановление рабочей БД: `deploy/restore.sh --full latest` (спросит «ВОССТАНОВИТЬ», сделает страховочный дамп, остановит app, пересоздаст БД, зальёт дамп, прогонит миграции, поднимет app). Затем `deploy/smoke.sh`.
- Восстановление на новой ВМ: bootstrap -> клон -> `.env` -> `deploy/deploy.sh` (создаст пустую БД) -> скопировать дамп на ВМ -> `deploy/restore.sh --full <файл>` -> `deploy/smoke.sh`.
- Бэкапы лежат на той же ВМ: для защиты от потери диска регулярно копируйте дамп вовне (S3-совместимое хранилище провайдера или снимок диска ВМ в его консоли).

## 12. Удаление ПДн, мониторинг

Удаление заявок, созданных раньше границы (необратимо, перед ним автоматически дамп). **Граница обязательна**, значения по умолчанию нет:

```bash
deploy/cleanup-pii.sh --yes 2027-01-03T00:00:00+03:00
```

Скрипт отказывается работать, если граница не распознана, позже текущего момента (иначе удалились бы свежие заявки) или позже 2027-01-03T00:00:00+03:00 (конец эталонной кампании, константа `CAMPAIGN_END` в `deploy/cleanup-pii.sh` — поправьте под даты своей кампании). Для последнего случая нужны отдельное подтверждение `--allow-late` и ввод слова `УДАЛИТЬ`: `deploy/cleanup-pii.sh --yes 2027-03-01T00:00:00+03:00 --allow-late`. Срок хранения ПДн определяет владелец; в логах PostgreSQL email игрока не оседает (`log_error_verbosity=terse`, `log_min_error_statement=panic` в `compose.yml`).

Мониторинг: внешняя проверка (UptimeRobot или аналог) HTTPS-запроса `https://DOMAIN/api/health` каждые 1-5 минут, ожидается 200 и слово `ok` (работает и в staging). Метрики: `curl -u "$ADMIN_USERNAME:$ADMIN_PASSWORD" https://DOMAIN/api/admin/metrics` (старты, завершения, подтверждённые заявки, ошибки писем; рост `emailFailures` — проверить SMTP). Состояние ВМ: `deploy/status.sh`. Логи: `deploy/logs.sh app -f`, `deploy/logs.sh caddy`. В журналах Caddy нет IP, токенов и заголовков авторизации.

## 13. Типовые проблемы

- **Let's Encrypt не выдал сертификат** (`deploy/logs.sh caddy`: ошибки ACME/challenge; curl к домену падает на TLS): проверьте `dig +short DOMAIN` = внешний IP ВМ; в группе безопасности / файрволе облачного провайдера открыты 80 и 443 с интернета (проверка идёт по 80/443); `ufw status`; `ACME_EMAIL` реальный; лимиты Let's Encrypt (повторы в течение часа не помогут, ждите). Сертификаты хранятся в томе `caddy_data` — не удаляйте его (`down -v` запрещён на боевой ВМ).
- **502 от Caddy**: app не готов или перезапускается. `deploy/status.sh`, `deploy/logs.sh app`. Проверить OOM: `docker inspect -f '{{.State.OOMKilled}}' quiz-app-1`.
- **app падает при старте**: в логах причина конфигурации (`QUIZ_FORCE_OPEN cannot be enabled...`, неверная переменная). Исправьте `/opt/quiz/.env`, `deploy/deploy.sh`.
- **403 «Недопустимый источник запроса»** в игре: адрес в браузере не равен `APP_URL` (например, `www.` или http). Должен совпадать с `https://DOMAIN`.
- **Нехватка памяти при сборке**: `free -h`, `swapon --show` (swap 2 ГБ создаёт bootstrap), `docker builder prune -f`. Лимиты контейнеров: db 768 МБ, app 1 ГБ, caddy/backup/mailpit 192 МБ.
- **Нехватка диска**: `df -h /`, `docker system df`, `docker image prune -f`, старые дампы удаляются сами через 14 дней.
- **Письма не доходят**: staging — смотрите Mailpit; production — `deploy/logs.sh app` (события `api_error`), метрика `emailFailures`, SPF/DKIM, порт/`SMTP_SECURE` (587 STARTTLS: `false`; 465: `true`).
- **Смена `POSTGRES_PASSWORD`**: `docker compose -p quiz -f deploy/compose.yml --env-file /opt/quiz/.env exec db psql -U quiz -c "ALTER USER quiz PASSWORD 'новый'"`, затем обновить `.env` и `deploy/deploy.sh`.
- **Потерян SSH**: проверьте IP администратора в группе безопасности облачного провайдера и `fail2ban-client status sshd` (через веб-консоль ВМ у провайдера).
- **Сброс окружения**: `docker compose ... down` без `-v`. Флаг `-v` удаляет БД и сертификаты.

## 14. Локальная проверка (как проверялось)

Без ВМ и без Let's Encrypt, под отдельным именем проекта и другими портами:

```bash
export QUIZ_ENV_FILE=/tmp/quiz-local/.env QUIZ_STATE_DIR=/tmp/quiz-local/state BACKUP_DIR=/tmp/quiz-local/backups \
  COMPOSE_PROJECT_NAME=quizdeploy QUIZ_COMPOSE_OVERRIDE=$PWD/deploy/compose.localcheck.yml QUIZ_SKIP_GIT=1
mkdir -p /tmp/quiz-local/state /tmp/quiz-local/backups
deploy/generate-secrets.sh staging
sed -i.bak -e 's/^DOMAIN=.*/DOMAIN=localhost/' -e 's/^ACME_EMAIL=.*/ACME_EMAIL=dev@quiz.test/' \
  -e 's#^APP_URL=.*#APP_URL=http://localhost:18080#' /tmp/quiz-local/.env   # локально домен localhost не проходит проверку --domain
echo 'CADDY_SITE_ADDRESS=http://localhost' >> /tmp/quiz-local/.env    # без TLS, только локально
deploy/deploy.sh && deploy/smoke.sh                                  # Mailpit UI: http://127.0.0.1:18025
docker compose -p quizdeploy -f deploy/compose.yml --env-file /tmp/quiz-local/.env down -v
docker rmi $(docker images 'quizdeploy-*' -q)
```

`compose.localcheck.yml` только переносит порты на 18080/18443/18025 и на ВМ не подключается. `CADDY_SITE_ADDRESS=http://...` отключает TLS: на ВМ эта переменная не задаётся, Caddy берёт `DOMAIN` и включает Let's Encrypt.

## 16. Общий сервер для нескольких клиентов и сервер клиента

Движок обслуживает много квизов одним процессом (арендатор выбирается по `Host`) либо один квиз на сервере клиента (`TENANT=<slug>`). Данные разделены по `campaignSlug`, админка — по арендатору.

### Два режима процесса

| | сервер клиента (один квиз) | общий сервер (много клиентов) |
|---|---|---|
| `.env` | `TENANT=<slug>`, `QUIZ_PACKS=<slug>` | `TENANT=` (пусто), `TENANT_BASE_DOMAIN=quiz.studio.ru`, `QUIZ_PACKS=all` или `slug1,slug2` |
| Адрес | один домен (`DOMAIN`) | `<slug>.<TENANT_BASE_DOMAIN>` и собственные домены клиентов (`hosts` в пакете) |
| Caddy | `Caddyfile` (один домен, Let's Encrypt) | `CADDYFILE=./Caddyfile.shared` (TLS по запросу) |
| Оператор | `ADMIN_*` из `.env` (администратор этого арендатора) или логины `quiz:admin` | логины клиентов `quiz:admin`; `ADMIN_*` работает только при `SUPERADMIN=true` |

В production с несколькими пакетами в образе и без `TENANT` и `TENANT_BASE_DOMAIN` процесс **не стартует** (`/api/health` отвечает 500, выкатка останавливается). Хосты в самих пакетах (в том числе `*.localhost` у демо) это не обходят.

### Образ только с нужными пакетами

`QUIZ_PACKS` — аргумент сборки образов `app` и `migrate` (`deploy/compose.yml`): `node scripts/select-packs.mjs` оставляет в `tenants/index.ts` только указанные пакеты и удаляет каталоги остальных. По умолчанию `QUIZ_PACKS` равен `TENANT` (при его отсутствии — `demo-office`), поэтому демо- и чужие пакеты в боевой образ клиента не попадают. Общий сервер задаёт `QUIZ_PACKS=all` или список. Образ клиента вручную: `docker build --target runner --build-arg QUIZ_PACKS=<slug> -t quiz-<slug> .`.

### DNS и TLS на общем сервере

1. Wildcard-запись `*.quiz.studio.ru` (и A-запись самого домена) на IP сервера. Собственный домен клиента — A-запись на тот же IP и строка в `hosts` пакета.
2. В `.env`: `CADDYFILE=./Caddyfile.shared`, `TENANT=`, `TENANT_BASE_DOMAIN=quiz.studio.ru`, `QUIZ_PACKS=all`, `TLS_ASK_TOKEN=<openssl rand -hex 24>`.
3. Сертификаты выпускаются **по запросу** при первом обращении к домену (Caddy on-demand TLS). Перед выпуском Caddy спрашивает приложение: `GET http://app:3000/api/internal/tls-ask?token=…&domain=<имя>`. Ответ 200 — домен принадлежит арендатору (`hosts` пакета или `<slug>.<TENANT_BASE_DOMAIN>`), 404 — нет (сертификат не выпускается и лимиты Let's Encrypt не тратятся), 403 — неверный токен. Без `TLS_ASK_TOKEN` проверка выключена (404 всегда), а в Caddyfile путь `/api/internal/*` снаружи закрыт.
4. Единый wildcard-сертификат (`*.quiz.studio.ru`) нужен только если не хочется ждать выпуска на первом обращении: он требует DNS-01, то есть Caddy с модулем DNS-провайдера (`xcaddy build --with github.com/caddy-dns/<провайдер>`) и блока `tls { dns … }`. Стандартный образ `caddy:2-alpine` этого не умеет, поэтому по умолчанию используется on-demand.

### Операторы клиентов

Пароли лежат в БД только хешем (scrypt), логин принадлежит арендатору (таблица `TenantAdmin`, миграция `…_tenant_admin`). `/admin` и `/api/admin/*` определяют арендатора по `Host`, а логин ищут только среди его операторов: пароль клиента A на домене клиента B не подходит, подмена `Host` данные другого арендатора не открывает.

```bash
# На ВМ — через образ migrate: в нём исходники, tsx и DATABASE_URL из .env (в образе app их нет, порт БД наружу закрыт).
docker compose -p quiz -f deploy/compose.yml --env-file /opt/quiz/.env run --rm migrate npm run quiz:admin -- <slug> --user ops   # создать или сменить пароль; пароль печатается один раз
docker compose -p quiz -f deploy/compose.yml --env-file /opt/quiz/.env run --rm migrate npm run quiz:admin -- <slug> --user ops --disable
docker compose -p quiz -f deploy/compose.yml --env-file /opt/quiz/.env run --rm migrate npm run quiz:admin -- <slug> --list
# Локально: DATABASE_URL=… npm run quiz:admin -- <slug> --user ops
```

`--password …` виден в `ps` и истории shell: без него пароль генерируется и печатается один раз.

Администратор из `ADMIN_USERNAME`/`ADMIN_PASSWORD` действует только явно: при `TENANT=<slug>` (процесс обслуживает один квиз) или при `SUPERADMIN=true` (общий сервер, доступ ко всем арендаторам для владельца платформы). Без этого общий пароль + подмена `Host` выгрузили бы ПДн любого клиента. `deploy/smoke.sh` на общем сервере требует `SUPERADMIN=true` и `APP_URL` на домене арендатора (`https://<slug>.<TENANT_BASE_DOMAIN>`): на самом базовом домене арендатор не определяется, и админка, и создание сессии отвечают отказом.

### Превью и передача клиенту

```bash
npm run quiz:check -- <slug>                       # схема, линт, симуляция
npm run quiz:preview -- <slug> --base-domain quiz.studio.ru [--ssh deploy@IP --deploy]
npm run quiz:export  -- <slug> --domain quiz.client.ru --email ops@client.ru [--build]
```

- `quiz:preview` проверяет пакет и git-состояние (пакет закоммичен, коммит есть в `origin`), с `--deploy` выкатывает через `deploy/deploy.sh` по SSH, запускает `deploy/smoke.sh --local` и проверяет `https://<slug>.<домен>/` (на закрытом стенде ожидается 401). Без `--deploy` печатает команды. Сайт закрыт staging-паролем общего сервера: ссылку и пароль передаёт владелец.
- `quiz:export` создаёт `exports/<slug>/` (в `.gitignore`): `.env` production для сервера клиента (секреты из `deploy/generate-secrets.sh`, права 600, в вывод не печатаются; `TENANT` и `QUIZ_PACKS` равны `<slug>`), `README.md` с шагами выкатки и, с `--build`, архив образов `app`/`migrate` только с пакетом клиента (нужен Docker).
- Юридические тексты пакета на согласовании блокируют production-старт (`assertLaunchReady`): экспорт предупреждает об этом.

ПДн: клиент — оператор, платформа — обработчик; в каждом пакете своя `legal`, в договоре — поручение на обработку.

## 15. Справочник скриптов

| Скрипт | Назначение |
|---|---|
| `bootstrap-vm.sh` | первичная настройка Ubuntu (root, один раз) |
| `generate-secrets.sh staging\|production [--domain D --email E --smtp-from F]` | создать `/opt/quiz/.env` с секретами и доменом (DOMAIN и APP_URL вместе) |
| `generate-secrets.sh --set-domain D` | сменить домен в существующем `.env` |
| `reset-staging-data.sh [--yes]` | очистить тестовые данные staging перед production (только staging) |
| `switch-mode.sh staging\|production` | переключить флаги режима в `.env` |
| `deploy.sh [ревизия]` | выкатка |
| `rollback.sh` | откат приложения (БД не трогает) |
| `backup-now.sh` | внеочередной дамп |
| `restore.sh [--full] <дамп\|latest>` | проверка / полное восстановление |
| `smoke.sh [--local] [--no-session]` | дымовая проверка |
| `status.sh`, `logs.sh` | состояние и логи |
| `Caddyfile.shared` | Caddy общего сервера: TLS по запросу + `ask` (раздел 16) |
| `cleanup-pii.sh --yes ГРАНИЦА [--allow-late]` | удаление ПДн (граница обязательна) |

Переменные окружения скриптов (для отладки): `QUIZ_ROOT`, `QUIZ_ENV_FILE`, `QUIZ_STATE_DIR`, `BACKUP_DIR`, `COMPOSE_PROJECT_NAME`, `QUIZ_SKIP_GIT`, `QUIZ_SKIP_BACKUP`, `QUIZ_COMPOSE_OVERRIDE`.
