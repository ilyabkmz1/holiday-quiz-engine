#!/usr/bin/env bash
# Общие функции скриптов deploy/. Подключается через `source`, сам не запускается.
# shellcheck shell=bash
# shellcheck disable=SC2034  # переменные используются скриптами, подключающими lib.sh

# --- Пути и окружение --------------------------------------------------------
QUIZ_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$QUIZ_LIB_DIR/.." && pwd)"
QUIZ_ROOT="${QUIZ_ROOT:-/opt/quiz}"
ENV_FILE="${QUIZ_ENV_FILE:-$QUIZ_ROOT/.env}"
STATE_DIR="${QUIZ_STATE_DIR:-$QUIZ_ROOT/state}"
export BACKUP_DIR="${BACKUP_DIR:-$QUIZ_ROOT/backups}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-quiz}"
DEPLOY_UID="$(id -u)"
DEPLOY_GID="$(id -g)"
export DEPLOY_UID DEPLOY_GID

# --- Сообщения ---------------------------------------------------------------
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BOLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BOLD=""; C_OFF=""
fi
step() { printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_OFF"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '%s[ОК]%s %s\n' "$C_GREEN" "$C_OFF" "$*"; }
warn() { printf '%s[ВНИМАНИЕ]%s %s\n' "$C_YELLOW" "$C_OFF" "$*" >&2; }
die() { printf '%s[ОШИБКА]%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }

# --- Чтение .env (без source: значения содержат пробелы и <>) ---------------
# env_get KEY [DEFAULT] — последнее непустое определение KEY=..., кавычки по краям снимаются.
env_get() {
  local key="$1" default="${2:-}" line value
  [ -f "$ENV_FILE" ] || { printf '%s' "$default"; return 0; }
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [ -z "$line" ]; then printf '%s' "$default"; return 0; fi
  value="${line#*=}"
  value="${value%$'\r'}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "${value:-$default}"
}

# env_set KEY VALUE — заменяет/добавляет строку KEY=VALUE в .env (значение берётся буквально, без разбора \\).
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    QUIZ_V="$value" awk -v k="$key" 'BEGIN{FS=OFS="="} $1==k {print k "=" ENVIRON["QUIZ_V"]; next} {print}' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"; printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

is_staging() { [ -n "$(env_get STAGING_USERNAME)" ] && [ -n "$(env_get STAGING_PASSWORD)" ]; }
mode_name() { if is_staging; then echo staging; else echo production; fi; }

# --- Docker Compose ----------------------------------------------------------
# dc ... — docker compose с боевым файлом, .env и именем проекта.
# QUIZ_COMPOSE_OVERRIDE — дополнительный файл ТОЛЬКО для локальной проверки (compose.localcheck.yml).
dc() {
  local args=(-p "$COMPOSE_PROJECT_NAME" -f "$QUIZ_LIB_DIR/compose.yml")
  if [ -n "${QUIZ_COMPOSE_OVERRIDE:-}" ]; then args+=(-f "$QUIZ_COMPOSE_OVERRIDE"); fi
  docker compose ${args[@]+"${args[@]}"} --env-file "$ENV_FILE" "$@"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker не установлен. Выполните deploy/bootstrap-vm.sh (см. deploy/README.md, шаг 4)."
  docker info >/dev/null 2>&1 || die "Нет доступа к Docker. Запускайте скрипт под пользователем deploy (группа docker); после добавления в группу нужен новый SSH-вход."
  docker compose version >/dev/null 2>&1 || die "Не найден docker compose plugin."
}

image_id() { docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true; }

# wait_healthy SERVICE TIMEOUT_SEC — ждёт состояние healthy у контейнера сервиса.
wait_healthy() {
  local service="$1" timeout="${2:-120}" waited=0 cid status
  while [ "$waited" -lt "$timeout" ]; do
    cid="$(dc ps -q "$service" 2>/dev/null | head -n 1 || true)"
    if [ -n "$cid" ]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
      case "$status" in
        healthy|running) return 0 ;;
        exited|dead) return 1 ;;
      esac
    fi
    sleep 3; waited=$((waited + 3))
  done
  return 1
}

# --- HTTP-проверки -----------------------------------------------------------
# vcurl [--resolve-local] [--auth USER PASS] URL [curl args] — curl без паролей в списке процессов.
# Печатает HTTP-код; тело ответа сохраняется в файл $VCURL_BODY (имя по PID скрипта, удаляется при выходе).
VCURL_BODY="${TMPDIR:-/tmp}/quiz-vcurl.$$"
trap 'rm -f "$VCURL_BODY"' EXIT
vcurl() {
  local resolve=0 user="" pass="" args=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --resolve-local) resolve=1; shift ;;
      --auth) user="$2"; pass="$3"; shift 3 ;;
      *) break ;;
    esac
  done
  local url="$1"; shift
  if [ "$resolve" = 1 ]; then
    local hostport scheme host port
    scheme="${url%%://*}"; hostport="${url#*://}"; hostport="${hostport%%/*}"
    host="${hostport%%:*}"
    if [ "$hostport" != "$host" ]; then port="${hostport##*:}"; elif [ "$scheme" = https ]; then port=443; else port=80; fi
    args+=(--resolve "$host:$port:127.0.0.1")
  fi
  if [ -n "$user" ]; then
    curl -sS -o "$VCURL_BODY" -w '%{http_code}' --max-time 20 ${args[@]+"${args[@]}"} -K <(printf 'user = "%s:%s"\n' "$user" "$pass") "$@" "$url" || echo "000"
  else
    curl -sS -o "$VCURL_BODY" -w '%{http_code}' --max-time 20 ${args[@]+"${args[@]}"} "$@" "$url" || echo "000"
  fi
}

# --- Проверка .env -----------------------------------------------------------
validate_env() {
  [ -f "$ENV_FILE" ] || die "Нет файла $ENV_FILE. Создайте его: deploy/generate-secrets.sh staging (или production)."
  local perms
  perms="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")"
  case "$perms" in
    600|400) ;;
    *) warn "Права $ENV_FILE: $perms. Выполняю chmod 600."; chmod 600 "$ENV_FILE" ;;
  esac

  if grep -E '^[A-Z_]+=.*CHANGE_ME' "$ENV_FILE" >/dev/null; then
    die "В $ENV_FILE остались значения CHANGE_ME_*: $(grep -E '^[A-Z_]+=.*CHANGE_ME' "$ENV_FILE" | cut -d= -f1 | tr '\n' ' '). Запустите deploy/generate-secrets.sh или впишите значения вручную."
  fi

  local key
  for key in DOMAIN ACME_EMAIL APP_URL POSTGRES_PASSWORD DATABASE_URL SMTP_HOST SMTP_PORT SMTP_FROM ADMIN_USERNAME ADMIN_PASSWORD; do
    [ -n "$(env_get "$key")" ] || die "В $ENV_FILE не задана переменная $key."
  done

  local domain site
  domain="$(env_get DOMAIN)"; site="$(env_get CADDY_SITE_ADDRESS)"
  if [ -z "${QUIZ_ALLOW_EXAMPLE_DOMAIN:-}" ]; then
    case "$domain" in *example.com|*example.org|*example.net) die "DOMAIN=$domain — это заглушка. Укажите реальный домен." ;; esac
    case "$(env_get ACME_EMAIL)" in *@example.com|*@example.org|*@example.net) die "ACME_EMAIL содержит заглушку example.*: Let's Encrypt её отклонит." ;; esac
  fi
  case "$(env_get APP_URL)" in
    *'$'*) die "APP_URL содержит подстановку ($(env_get APP_URL)): скрипты читают .env без подстановки. Запишите литерал: deploy/generate-secrets.sh --set-domain $domain" ;;
  esac
  case "$site" in
    http://*) warn "CADDY_SITE_ADDRESS=$site: TLS отключён (режим локальной проверки). На ВМ так быть не должно." ;;
    *) [ "$(env_get APP_URL)" = "https://$domain" ] || die "APP_URL должен быть ровно https://$domain (сейчас: $(env_get APP_URL)). Исправить: deploy/generate-secrets.sh --set-domain $domain" ;;
  esac
  { [ -n "$(env_get SMTP_USER)" ] && [ -n "$(env_get SMTP_PASSWORD)" ]; } || { [ -z "$(env_get SMTP_USER)" ] && [ -z "$(env_get SMTP_PASSWORD)" ]; } \
    || die "SMTP_USER и SMTP_PASSWORD задаются только вместе (для SMTP без авторизации оставьте оба пустыми)."
  case "$(env_get DATABASE_URL)" in *"@db:5432/"*) ;; *) die "DATABASE_URL должен указывать на сервис db (...@db:5432/quiz)." ;; esac
  local admin_password
  admin_password="$(env_get ADMIN_PASSWORD)"
  [ "${#admin_password}" -ge 16 ] || die "ADMIN_PASSWORD короче 16 символов."

  local su sp profiles force smtp
  su="$(env_get STAGING_USERNAME)"; sp="$(env_get STAGING_PASSWORD)"
  profiles="$(env_get COMPOSE_PROFILES)"; force="$(env_get QUIZ_FORCE_OPEN false)"; smtp="$(env_get SMTP_HOST)"
  if [ -n "$su" ] || [ -n "$sp" ]; then
    { [ -n "$su" ] && [ -n "$sp" ]; } || die "STAGING_USERNAME и STAGING_PASSWORD задаются только вместе."
    [ "${#sp}" -ge 16 ] || die "STAGING_PASSWORD короче 16 символов."
    if [ "$smtp" = mailpit ]; then
      case "$profiles" in *staging*) ;; *) die "SMTP_HOST=mailpit, но COMPOSE_PROFILES не содержит staging: Mailpit не запустится." ;; esac
    fi
  else
    # Боевой режим: никакого обхода дат, никакого Mailpit.
    [ "$force" != true ] || die "QUIZ_FORCE_OPEN=true без STAGING_USERNAME/STAGING_PASSWORD: приложение откажется стартовать. Поставьте false для боевого режима."
    case "$profiles" in *staging*) die "COMPOSE_PROFILES содержит staging в боевом режиме (запустится Mailpit). Очистите значение." ;; esac
    [ "$smtp" != mailpit ] || die "Боевой режим с SMTP_HOST=mailpit: письма игроков не уйдут. Укажите настоящий SMTP."
  fi
}
