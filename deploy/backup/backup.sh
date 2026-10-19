#!/bin/sh
# Дамп PostgreSQL внутри контейнера backup. Режимы:
#   loop  - бесконечный цикл: ежедневный дамп в BACKUP_HOUR_UTC (по умолчанию стартовый дамп, если свежего нет)
#   once  - один дамп сейчас (его же вызывает deploy/backup-now.sh)
# Формат: pg_dump -Fc (custom), файлы /backups/quiz-YYYYmmddTHHMMSSZ.dump. Хранение BACKUP_RETENTION_DAYS дней.
set -eu

BACKUP_DIR=/backups
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
HOUR="${BACKUP_HOUR_UTC:-0}"
MIN_BYTES=2048

log() { printf '{"event":"%s","msg":"%s"}\n' "$1" "$2"; }

backup_once() {
  umask 077
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  tmp="$BACKUP_DIR/.quiz-$stamp.dump.tmp"
  final="$BACKUP_DIR/quiz-$stamp.dump"
  if ! pg_dump -Fc -f "$tmp"; then
    rm -f "$tmp"; log backup_failed "pg_dump завершился с ошибкой"; return 1
  fi
  size="$(wc -c < "$tmp")"
  if [ "$size" -lt "$MIN_BYTES" ]; then
    rm -f "$tmp"; log backup_failed "дамп пустой или подозрительно мал ($size байт)"; return 1
  fi
  # Дамп должен читаться pg_restore и содержать таблицы данных.
  if ! pg_restore -l "$tmp" | grep -q 'TABLE DATA'; then
    rm -f "$tmp"; log backup_failed "в дампе нет данных таблиц"; return 1
  fi
  mv "$tmp" "$final"
  log backup_ok "$final ($size байт)"
  find "$BACKUP_DIR" -maxdepth 1 -name 'quiz-*.dump' -type f -mtime "+$((RETENTION_DAYS - 1))" -print -delete \
    | while read -r old; do log backup_pruned "$old"; done
}

seconds_until_next_run() {
  now="$(date -u +%s)"
  target=$(( now - now % 86400 + HOUR * 3600 ))
  [ "$target" -le "$now" ] && target=$(( target + 86400 ))
  echo $(( target - now ))
}

case "${1:-loop}" in
  once) backup_once ;;
  loop)
    # Свежего дампа (моложе 24 часов) нет — делаем сразу, чтобы новый стенд не оставался без копии.
    if [ -z "$(find "$BACKUP_DIR" -maxdepth 1 -name 'quiz-*.dump' -mmin -1440 2>/dev/null)" ]; then
      backup_once || true
    fi
    while true; do
      wait_s="$(seconds_until_next_run)"
      log backup_scheduled "следующий дамп через $wait_s с"
      sleep "$wait_s"
      backup_once || true
    done
    ;;
  *) echo "usage: backup.sh [loop|once]" >&2; exit 2 ;;
esac
