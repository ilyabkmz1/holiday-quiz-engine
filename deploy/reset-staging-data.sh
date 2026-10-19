#!/usr/bin/env bash
# Очистка тестовых данных staging перед переходом в production (deploy/README.md, раздел 9).
#   deploy/reset-staging-data.sh [--yes]
# TRUNCATE игровых таблиц и заявок (сессии, ответы, финальный рывок, заявки, подтверждения, аудит), схема и таблица
# Campaign сохраняются. Необратимо: перед очисткой автоматически делается дамп. Работает ТОЛЬКО в режиме
# staging (заданы STAGING_*) -- в боевом режиме отказывается, чтобы не стереть настоящие заявки.
# Без --yes потребует ввести слово ОЧИСТИТЬ. Порядок: финальный бэкап -> этот скрипт -> switch-mode production.
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

YES=0
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    *) die "Использование: deploy/reset-staging-data.sh [--yes]" ;;
  esac
done
require_docker
validate_env
is_staging || die "Режим не staging (STAGING_* не заданы): очистка запрещена, чтобы не стереть боевые данные. Очистку делают ДО switch-mode.sh production."

dc up -d db backup >/dev/null
wait_healthy db 90 || die "БД не healthy."
psql_q() { dc exec -T db psql -X -At -U quiz -d quiz -v ON_ERROR_STOP=1 "$@"; }
COUNTS_SQL='SELECT (SELECT count(*) FROM "GameSession") || '"' сессий, '"' || (SELECT count(*) FROM "PrizeClaim") || '"' заявок, '"' || (SELECT count(*) FROM "Campaign") || '"' кампаний'"''

step "Сейчас в БД: $(psql_q -c "$COUNTS_SQL" | tr -d '\r')"
warn "Будут удалены ВСЕ тестовые сессии, ответы, заявки и их подтверждения. Схема и Campaign сохраняются."
if [ "$YES" != 1 ]; then
  printf 'Для продолжения введите слово ОЧИСТИТЬ: '
  read -r answer
  [ "$answer" = "ОЧИСТИТЬ" ] || die "Отменено."
fi

step "Дамп перед очисткой"
dc exec -T backup /bin/sh /scripts/backup.sh once || die "Дамп не создан: очистка остановлена."

step "TRUNCATE игровых таблиц и заявок"
psql_q -c 'TRUNCATE TABLE "RushAnswer", "RushRun", "TaskShown", "RoomEntry", "TaskAnswer", "Answer", "EmailVerification", "PrizeClaim", "GameSession", "AuditEvent" RESTART IDENTITY'
AFTER="$(psql_q -c "$COUNTS_SQL" | tr -d '\r')"
info "После очистки: $AFTER"
case "$AFTER" in "0 сессий, 0 заявок, "[1-9]*) ;; *) die "Очистка не дала нулей или потеряна кампания: $AFTER" ;; esac
ok "Тестовые данные удалены. Проверьте нули: curl -u \"\$ADMIN_USERNAME:\$ADMIN_PASSWORD\" https://$(env_get DOMAIN)/api/admin/metrics"
