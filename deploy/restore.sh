#!/usr/bin/env bash
# Восстановление PostgreSQL из дампа.
#
#   deploy/restore.sh [--keep] <дамп|latest>
#       ПРОВЕРКА (по умолчанию, безопасно): восстанавливает дамп в ОТДЕЛЬНУЮ базу quiz_restore_check,
#       печатает число строк по таблицам и удаляет проверочную базу (--keep оставляет её). Рабочая БД не затрагивается.
#
#   deploy/restore.sh --full [--yes] <дамп|latest>
#       ПОЛНОЕ ВОССТАНОВЛЕНИЕ рабочей БД: останавливает app, делает страховочный дамп, пересоздаёт БД quiz,
#       заливает дамп, применяет миграции и запускает app. ВСЕ данные после момента дампа будут потеряны.
#       Без --yes потребует ввести слово ВОССТАНОВИТЬ.
#
# «Дамп» — путь к файлу или имя в /opt/quiz/backups; latest — самый свежий.
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MODE=check; KEEP=0; YES=0; DUMP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --full) MODE=full ;;
    --keep) KEEP=1 ;;
    --yes) YES=1 ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) die "Неизвестная опция $1" ;;
    *) DUMP="$1" ;;
  esac
  shift
done
[ -n "$DUMP" ] || die "Укажите дамп: deploy/restore.sh latest   (или путь к файлу). Список: ls -lh $BACKUP_DIR"

require_docker
[ -f "$ENV_FILE" ] || die "Нет $ENV_FILE."
if [ "$DUMP" = latest ]; then
  DUMP="$(find "$BACKUP_DIR" -maxdepth 1 -name 'quiz-*.dump' -type f | sort | tail -n 1)"
  [ -n "$DUMP" ] || die "В $BACKUP_DIR нет дампов."
elif [ ! -f "$DUMP" ] && [ -f "$BACKUP_DIR/$DUMP" ]; then
  DUMP="$BACKUP_DIR/$DUMP"
fi
[ -f "$DUMP" ] || die "Файл дампа не найден: $DUMP"
[ -s "$DUMP" ] || die "Файл дампа пустой: $DUMP"
info "Дамп: $DUMP ($(wc -c < "$DUMP") байт)"

dc up -d db backup >/dev/null
wait_healthy db 90 || die "БД не healthy."

psql_admin() { dc exec -T backup psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
restore_into() { dc exec -T backup pg_restore --no-owner --exit-on-error -d "$1" < "$DUMP"; }

print_counts() {
  dc exec -T backup psql -X -At -F ' | ' -d "$1" -c "
    SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
    FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1"
}

if [ "$MODE" = check ]; then
  CHECK_DB=quiz_restore_check
  step "Проверка восстановления в отдельную БД $CHECK_DB"
  psql_admin -c "DROP DATABASE IF EXISTS $CHECK_DB WITH (FORCE)" -c "CREATE DATABASE $CHECK_DB"
  restore_into "$CHECK_DB" || { psql_admin -c "DROP DATABASE IF EXISTS $CHECK_DB WITH (FORCE)" || true; die "pg_restore завершился с ошибкой: дамп НЕ пригоден."; }
  ok "pg_restore выполнен без ошибок. Строк по таблицам (таблица | строк):"
  print_counts "$CHECK_DB" | sed 's/^/    /'
  if [ "$KEEP" = 1 ]; then
    info "База $CHECK_DB оставлена (--keep). Удалить: dc exec backup psql -d postgres -c 'DROP DATABASE $CHECK_DB'"
  else
    psql_admin -c "DROP DATABASE $CHECK_DB WITH (FORCE)"
    info "Проверочная база удалена."
  fi
  ok "Дамп пригоден для восстановления."
  exit 0
fi

# --- Полное восстановление ---------------------------------------------------
step "ПОЛНОЕ ВОССТАНОВЛЕНИЕ рабочей БД quiz из $DUMP"
warn "Все данные игроков, внесённые после создания этого дампа, будут потеряны."
if [ "$YES" != 1 ]; then
  printf 'Для продолжения введите слово ВОССТАНОВИТЬ: '
  read -r answer
  [ "$answer" = "ВОССТАНОВИТЬ" ] || die "Отменено."
fi

info "Страховочный дамп текущего состояния..."
dc exec -T backup /bin/sh /scripts/backup.sh once || die "Страховочный дамп не создан — восстановление остановлено."
info "Останавливаем app (caddy будет отвечать 502 до конца восстановления)..."
dc stop app
psql_admin -c "DROP DATABASE IF EXISTS quiz WITH (FORCE)" -c "CREATE DATABASE quiz"
restore_into quiz || die "pg_restore завершился с ошибкой. Рабочая БД пуста! Страховочный дамп лежит в $BACKUP_DIR (самый свежий до этого), повторите restore.sh --full с ним."
ok "Дамп залит. Применяем миграции (если дамп старее текущей схемы)..."
dc run --rm --no-deps -T migrate
dc up -d app
wait_healthy app 120 || die "app не стал healthy после восстановления: deploy/logs.sh app."
ok "Восстановление завершено. Проверьте: deploy/smoke.sh и deploy/status.sh"
