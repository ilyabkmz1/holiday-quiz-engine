#!/usr/bin/env bash
# Сводка состояния: режим, ревизия, контейнеры, последний дамп, диск и память.
# Использование: deploy/status.sh
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_docker
[ -f "$ENV_FILE" ] || die "Нет $ENV_FILE."

step "Режим и версия"
info "Режим:      $(mode_name)"
info "Домен:      $(env_get DOMAIN)   APP_URL: $(env_get APP_URL)"
info "Ревизия:    $(cd "$REPO_DIR" && git rev-parse --short HEAD 2>/dev/null || echo '?') (выкачена успешно: $(cut -c1-7 "$STATE_DIR/current_rev" 2>/dev/null || echo '-'), $(cat "$STATE_DIR/deployed_at" 2>/dev/null || echo '-'))"
info "Предыдущая: $(cut -c1-7 "$STATE_DIR/previous_rev" 2>/dev/null || echo '-')"

step "Контейнеры"
dc ps -a

step "Резервные копии ($BACKUP_DIR)"
latest="$(find "$BACKUP_DIR" -maxdepth 1 -name 'quiz-*.dump' -type f 2>/dev/null | sort | tail -n 1 || true)"
if [ -n "$latest" ]; then
  info "Всего дампов: $(find "$BACKUP_DIR" -maxdepth 1 -name 'quiz-*.dump' -type f | wc -l | tr -d ' ')"
  info "Последний:    $latest ($(wc -c < "$latest") байт)"
  if [ -z "$(find "$BACKUP_DIR" -maxdepth 1 -name 'quiz-*.dump' -mmin -1560 -type f)" ]; then
    warn "Последний дамп старше 26 часов! deploy/logs.sh backup"
  fi
else
  warn "Дампов нет."
fi

step "Ресурсы"
df -h / | tail -n 1 | awk '{print "    Диск /: занято " $3 " из " $2 " (" $5 ")"}'
if command -v free >/dev/null 2>&1; then free -h | sed -n '1,3p' | sed 's/^/    /'; fi
running="$(dc ps -q 2>/dev/null | tr '\n' ' ')"
# shellcheck disable=SC2086
[ -z "$running" ] || docker stats --no-stream --format '    {{.Name}}: CPU {{.CPUPerc}}, память {{.MemUsage}}' $running 2>/dev/null || true
