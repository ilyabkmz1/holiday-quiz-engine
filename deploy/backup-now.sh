#!/usr/bin/env bash
# Внеочередной дамп PostgreSQL (тот же код, что и ежедневный: проверка, что дамп непустой и читается).
# Использование: deploy/backup-now.sh   -> файл в /opt/quiz/backups/quiz-<UTC>.dump
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_docker
[ -f "$ENV_FILE" ] || die "Нет $ENV_FILE."
[ -n "$(dc ps -q --status running backup 2>/dev/null)" ] || die "Контейнер backup не запущен. Запустите стек: deploy/deploy.sh (или dc up -d db backup)."

step "Создаём дамп"
dc exec -T backup /bin/sh /scripts/backup.sh once
latest="$(find "$BACKUP_DIR" -maxdepth 1 -name 'quiz-*.dump' -type f | sort | tail -n 1)"
[ -n "$latest" ] || die "Дамп не появился в $BACKUP_DIR."
ok "Дамп: $latest ($(wc -c < "$latest") байт)"
info "Проверка восстановления: deploy/restore.sh latest"
info "Скопировать себе: scp deploy@<IP>:$latest ."
