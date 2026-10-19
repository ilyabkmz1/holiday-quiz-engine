#!/usr/bin/env bash
# Переключает флаги режима в /opt/quiz/.env (секреты и домен не трогает). Старый файл сохраняется как .bak-<время>.
#   deploy/switch-mode.sh production   COMPOSE_PROFILES пуст, QUIZ_FORCE_OPEN=false, STAGING_* закомментированы
#   deploy/switch-mode.sh staging      COMPOSE_PROFILES=staging, QUIZ_FORCE_OPEN=true, STAGING_* раскомментированы
#                                      (если STAGING_PASSWORD не было — генерируется новый)
# SMTP скрипт НЕ меняет: для production впишите настоящий SMTP_* вручную, для staging — SMTP_HOST=mailpit, SMTP_PORT=1025,
# SMTP_USER и SMTP_PASSWORD пустые. После переключения: deploy/deploy.sh (валидатор .env не даст выкатить неполный режим).
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TARGET="${1:-}"
case "$TARGET" in staging|production) ;; *) die "Использование: deploy/switch-mode.sh staging|production" ;; esac
[ -f "$ENV_FILE" ] || die "Нет $ENV_FILE."
cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"

if [ "$TARGET" = production ]; then
  env_set COMPOSE_PROFILES ""
  env_set QUIZ_FORCE_OPEN false
  sed -i.tmp -E 's/^(STAGING_USERNAME=)/# \1/; s/^(STAGING_PASSWORD=)/# \1/' "$ENV_FILE" && rm -f "$ENV_FILE.tmp"
  ok "Файл переведён в production: профиль staging выключен, force-open выключен, STAGING_* закомментированы."
  warn "Проверьте SMTP_* (настоящий SMTP, не mailpit) и выполните deploy/deploy.sh. Затем deploy/smoke.sh."
else
  sed -i.tmp -E 's/^# (STAGING_USERNAME=)/\1/; s/^# (STAGING_PASSWORD=)/\1/' "$ENV_FILE" && rm -f "$ENV_FILE.tmp"
  grep -qE '^STAGING_USERNAME=' "$ENV_FILE" || env_set STAGING_USERNAME preview
  grep -qE '^STAGING_PASSWORD=' "$ENV_FILE" || env_set STAGING_PASSWORD "$(openssl rand -hex 24)"
  env_set COMPOSE_PROFILES staging
  env_set QUIZ_FORCE_OPEN true
  ok "Файл переведён в staging: Basic auth включён, force-open включён, профиль staging (Mailpit) включён."
  warn "Проверьте SMTP: SMTP_HOST=mailpit, SMTP_PORT=1025, SMTP_USER/SMTP_PASSWORD пустые. Затем deploy/deploy.sh."
fi
