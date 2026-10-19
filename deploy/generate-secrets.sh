#!/usr/bin/env bash
# Создаёт /opt/quiz/.env из шаблона и подставляет случайные секреты (openssl rand) и реальный домен.
# Использование:
#   deploy/generate-secrets.sh staging|production [--force] [--domain D] [--email E] [--smtp-from "Имя <a@b>"]
#       создать .env (с --force -- перезаписать, старый сохраняется). --domain подставляет DOMAIN и
#       APP_URL=https://D одновременно; без --domain в файле остаётся quiz.example.com, и deploy.sh откажется работать.
#   deploy/generate-secrets.sh --set-domain D     сменить домен в существующем .env (DOMAIN и APP_URL вместе)
#   deploy/generate-secrets.sh --print            просто напечатать один случайный секрет
# Что остаётся заполнить вручную, если не передано: ACME_EMAIL, SMTP_FROM, в production -- SMTP_*.
# ВАЖНО: POSTGRES_PASSWORD записывается в том БД при ПЕРВОМ запуске. Менять его в .env позже нельзя без
# ALTER USER в самой БД (см. deploy/README.md).
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

secret() { openssl rand -hex 24; }
USAGE="Использование: deploy/generate-secrets.sh staging|production [--force] [--domain D] [--email E] [--smtp-from F] | --set-domain D | --print"

check_domain() {
  [[ "$1" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || die "Некорректный домен '$1' (ожидается вроде quiz.company.ru, без https:// и пути)."
}

apply_domain() { # apply_domain D -- DOMAIN и APP_URL всегда меняются вместе
  check_domain "$1"
  env_set DOMAIN "$1"
  env_set APP_URL "https://$1"
}

if [ "${1:-}" = "--print" ]; then secret; exit 0; fi
if [ "${1:-}" = "--set-domain" ]; then
  [ -n "${2:-}" ] || die "$USAGE"
  [ -f "$ENV_FILE" ] || die "Нет $ENV_FILE. Сначала: deploy/generate-secrets.sh staging --domain $2"
  apply_domain "$2"
  ok "В $ENV_FILE: DOMAIN=$2, APP_URL=https://$2"
  exit 0
fi

MODE="${1:-}"; shift || true
case "$MODE" in staging|production) ;; *) die "$USAGE" ;; esac
FORCE=""; DOMAIN_ARG=""; EMAIL_ARG=""; FROM_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --domain) [ -n "${2:-}" ] || die "$USAGE"; DOMAIN_ARG="$2"; shift 2 ;;
    --email) [ -n "${2:-}" ] || die "$USAGE"; EMAIL_ARG="$2"; shift 2 ;;
    --smtp-from) [ -n "${2:-}" ] || die "$USAGE"; FROM_ARG="$2"; shift 2 ;;
    *) die "Неизвестная опция $1. $USAGE" ;;
  esac
done
command -v openssl >/dev/null 2>&1 || die "Нужен openssl (apt install openssl)."
[ -z "$DOMAIN_ARG" ] || check_domain "$DOMAIN_ARG"

TEMPLATE="$QUIZ_LIB_DIR/.env.$MODE.example"
[ -f "$TEMPLATE" ] || die "Нет шаблона $TEMPLATE"
if [ -e "$ENV_FILE" ]; then
  [ -n "$FORCE" ] || die "$ENV_FILE уже существует. Не перезаписываю. Для замены: --force (старый файл будет сохранён как .bak)."
  cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
fi

mkdir -p "$(dirname "$ENV_FILE")"
umask 077
sed \
  -e "s/CHANGE_ME_POSTGRES/$(secret)/" \
  -e "s/CHANGE_ME_ADMIN/$(secret)/" \
  -e "s/CHANGE_ME_STAGING/$(secret)/" \
  "$TEMPLATE" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
[ -z "$DOMAIN_ARG" ] || apply_domain "$DOMAIN_ARG"
[ -z "$EMAIL_ARG" ] || env_set ACME_EMAIL "$EMAIL_ARG"
[ -z "$FROM_ARG" ] || env_set SMTP_FROM "$FROM_ARG"

ok "Создан $ENV_FILE (режим $MODE, права 600). Секреты сгенерированы и в вывод не печатаются."
[ -n "$DOMAIN_ARG" ] || warn "Домен не задан: выполните deploy/generate-secrets.sh --set-domain <домен> (DOMAIN и APP_URL меняются вместе)."
info "Проверьте и заполните вручную: ACME_EMAIL, SMTP_FROM$( [ "$MODE" = production ] && echo ', SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD')."
info "Посмотреть логин/пароль админки:  grep -E '^ADMIN_' $ENV_FILE"
[ "$MODE" != staging ] || info "Посмотреть staging-доступ:        grep -E '^STAGING_' $ENV_FILE"
exit 0
