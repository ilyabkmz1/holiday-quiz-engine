#!/usr/bin/env bash
# Выкатка ревизии на ВМ: git fetch + checkout, сборка образов, бэкап, миграции, запуск, проверки.
# Использование (под пользователем deploy):  deploy/deploy.sh [ревизия]    по умолчанию origin/main
# Опции окружения (для отладки): QUIZ_SKIP_GIT=1 — не трогать git; QUIZ_SKIP_BACKUP=1 — без дампа перед миграциями.
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REV_ARG="${1:-origin/main}"
# Абсолютный путь: stage 2 запускается через exec уже после cd "$REPO_DIR", относительный путь тогда ломается.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
PHASE_FILE="$STATE_DIR/deploy_phase"
set_phase() { mkdir -p "$STATE_DIR"; printf '%s\n' "$1" > "$PHASE_FILE"; }

stage1_checkout() {
  step "Шаг 1/7. Получаем код ($REV_ARG)"
  cd "$REPO_DIR"
  if [ "${QUIZ_SKIP_GIT:-0}" = 1 ]; then
    warn "QUIZ_SKIP_GIT=1: git не трогаем, берём рабочее дерево как есть."
  else
    [ -z "$(git status --porcelain --untracked-files=no)" ] || die "В $REPO_DIR есть локальные изменения отслеживаемых файлов. На ВМ код не правят: git status, затем git checkout -- . или git stash."
    git fetch --prune origin
    local target
    target="$(git rev-parse --verify --quiet "${REV_ARG}^{commit}")" || die "Ревизия '$REV_ARG' не найдена после git fetch. Проверьте имя ветки, тега или хеша."
    git checkout --detach --quiet "$target"
  fi
  info "Ревизия: $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"
  # Перезапускаемся уже из скрипта целевой ревизии (bash читает файл по мере исполнения).
  export QUIZ_DEPLOY_STAGE2=1
  exec bash "$SELF" "$@"
}

fail() {
  local what="$1" hint="$2"
  printf '\n%s[ОШИБКА ВЫКАТКИ]%s %s\n' "$C_RED" "$C_OFF" "$what" >&2
  printf '\n--- docker compose ps ---\n' >&2
  dc ps -a >&2 || true
  printf '\n--- последние логи app/caddy/migrate ---\n' >&2
  dc logs --no-color --tail 20 app caddy migrate >&2 || true
  printf '\n%s\n' "$hint" >&2
  if [ "$(cat "$PHASE_FILE" 2>/dev/null || true)" = started ]; then
    printf '\nПредыдущая рабочая версия сохранена (образы :current). Откат: deploy/rollback.sh\n' >&2
  else
    printf '\nСервисы ещё не перезапускались: продолжает работать прежняя версия, откат не нужен. Исправьте причину и повторите deploy/deploy.sh.\n' >&2
  fi
  printf 'Подробнее: deploy/README.md, раздел «Типовые проблемы».\n' >&2
  exit 1
}

main() {
  local app_img="${COMPOSE_PROJECT_NAME}-app" mig_img="${COMPOSE_PROJECT_NAME}-migrate"
  local rev short mode base domain cur_rev
  cd "$REPO_DIR"
  rev="$(git rev-parse HEAD 2>/dev/null || echo unknown)"; short="${rev:0:7}"
  mode="$(mode_name)"; base="$(env_get APP_URL)"; domain="$(env_get DOMAIN)"
  mkdir -p "$STATE_DIR"
  cur_rev="$(cat "$STATE_DIR/current_rev" 2>/dev/null || echo none)"

  step "Шаг 2/7. Проверка окружения (режим: $mode, домен: $domain)"
  require_docker
  validate_env
  ok "docker и $ENV_FILE в порядке"
  if [ "$mode" = production ]; then
    info "БОЕВОЙ режим: Basic auth выключен, force-open выключен."
  else
    info "STAGING: сайт закрыт Basic auth, письма идут в Mailpit."
  fi

  # Ревизия попадает в образ (ARG APP_VERSION) и отдаётся в GET /api/health.
  export APP_VERSION="$short"

  set_phase prestart
  step "Шаг 3/7. Сборка образов (на 2 vCPU/4 ГБ это 3-8 минут; сайт пока работает на старом образе)"
  dc build app migrate || fail "Сборка образа не удалась." "Частая причина — нехватка памяти или места: free -h, df -h /, docker system df. Освободить место: docker builder prune -f && docker image prune -f. Проверьте, что включён swap (swapon --show)."

  step "Шаг 4/7. База данных и дамп перед миграциями"
  dc up -d db || fail "Не запустилась БД." "Логи: deploy/logs.sh db. Если пароль в .env менялся после первого запуска — том БД хранит старый пароль (см. README)."
  wait_healthy db 90 || fail "БД не стала healthy за 90 с." "Смотрите deploy/logs.sh db."
  if [ "${QUIZ_SKIP_BACKUP:-0}" != 1 ] && [ -n "$(dc ps -q --status running backup 2>/dev/null)" ]; then
    dc exec -T backup /bin/sh /scripts/backup.sh once || fail "Дамп перед миграциями не создан." "Выкатку остановили, чтобы не менять схему без копии. Разберитесь с backup (deploy/logs.sh backup) или повторите с QUIZ_SKIP_BACKUP=1 осознанно."
    ok "дамп перед миграциями создан"
  else
    info "Контейнер backup ещё не запущен (первая выкатка) или QUIZ_SKIP_BACKUP=1 — дамп пропущен."
  fi

  step "Шаг 5/7. Миграции Prisma (аддитивные, БД при откате не откатывается)"
  dc run --rm --no-deps -T migrate || fail "Миграции не применились. Приложение НЕ перезапускалось." "Исправьте причину по логам выше и повторите deploy/deploy.sh. Старая версия продолжает работать."

  step "Шаг 6/7. Запуск и обновление сервисов"
  # В боевом режиме Mailpit не должен оставаться от прошлого staging-запуска.
  [ "$mode" = staging ] || dc --profile staging rm -sf mailpit >/dev/null 2>&1 || true
  # Миграции уже применены шагом 5: migrate не перезапускаем (--no-deps), поэтому сервисы без него.
  local services
  set_phase started
  services="$(dc config --services | grep -vxE 'migrate|caddy' | tr '\n' ' ')"
  # shellcheck disable=SC2086
  dc up -d --no-deps --remove-orphans $services || fail "docker compose up завершился с ошибкой." "Логи приложения: deploy/logs.sh app. Нет доступа к БД/SMTP, неверная переменная окружения — приложение падает при старте с понятным сообщением."
  wait_healthy app 120 || fail "app не стал healthy за 120 с." "Смотрите deploy/logs.sh app — причина указана в первых строках."
  dc up -d --no-deps caddy || fail "caddy не запустился." "Логи: deploy/logs.sh caddy."
  ok "app healthy"

  step "Шаг 7/7. Проверка через Caddy ($base)"
  local code deadline=$((SECONDS + 150)) su sp
  su="$(env_get STAGING_USERNAME)"; sp="$(env_get STAGING_PASSWORD)"
  # Первая выдача сертификата Let's Encrypt занимает до минуты; до тех пор curl падает на TLS.
  while true; do
    code="$(vcurl --resolve-local "$base/api/health")"
    [ "$code" = 200 ] && break
    [ "$SECONDS" -lt "$deadline" ] || fail "$base/api/health отвечает $code (ожидалось 200)." "Для 000/TLS-ошибки: DNS A-запись домена и порты 80/443 в группе безопасности облачного провайдера, логи: deploy/logs.sh caddy. Для 502: deploy/logs.sh app."
    sleep 5
  done
  ok "/api/health: 200"
  if [ "$mode" = staging ]; then
    code="$(vcurl --resolve-local --auth "$su" "$sp" "$base/api/ready")"
  else
    code="$(vcurl --resolve-local "$base/api/ready")"
  fi
  [ "$code" = 200 ] || fail "$base/api/ready отвечает $code (ожидалось 200)." "/api/ready проверяет БД. Смотрите deploy/logs.sh db и app."
  ok "/api/ready: 200"
  code="$(vcurl --resolve-local "$base/")"
  if [ "$mode" = staging ]; then
    [ "$code" = 401 ] || fail "В staging главная без пароля отвечает $code, а должна 401: сайт НЕ закрыт." "Проверьте, что STAGING_USERNAME/STAGING_PASSWORD попали в контейнер: dc exec app env | grep -c STAGING (значения не выводите в чат)."
    ok "главная без пароля: 401 (сайт закрыт)"
  else
    [ "$code" = 200 ] || fail "Главная отвечает $code (ожидалось 200)." "Смотрите deploy/logs.sh app и caddy."
    ok "главная: 200"
  fi

  # Новая версия подтверждена: ротация меток образов для отката.
  if [ "$rev" != "$cur_rev" ]; then
    if [ -n "$(image_id "$app_img:current")" ]; then
      docker tag "$app_img:current" "$app_img:previous"
      [ -z "$(image_id "$mig_img:current")" ] || docker tag "$mig_img:current" "$mig_img:previous"
      printf '%s\n' "$cur_rev" > "$STATE_DIR/previous_rev"
    fi
  fi
  docker tag "$app_img:latest" "$app_img:current"
  docker tag "$mig_img:latest" "$mig_img:current"
  printf '%s\n' "$rev" > "$STATE_DIR/current_rev"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$STATE_DIR/deployed_at"
  set_phase ok
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f --filter 'until=168h' >/dev/null 2>&1 || true

  step "Готово"
  dc ps
  printf '\n%s[ВЫКАТКА УСПЕШНА]%s ревизия %s, режим %s, %s\n' "$C_GREEN" "$C_OFF" "$short" "$mode" "$base"
  info "Дальше: deploy/smoke.sh  (полная проверка игры). Откат: deploy/rollback.sh"
}

if [ -z "${QUIZ_DEPLOY_STAGE2:-}" ]; then
  stage1_checkout "$@"
fi
main
exit 0
