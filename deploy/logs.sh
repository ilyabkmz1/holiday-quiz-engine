#!/usr/bin/env bash
# Логи сервисов стека.  Использование: deploy/logs.sh [сервис ...] [-f] [-n ЧИСЛО]
#   сервисы: app, caddy, db, backup, migrate, mailpit. Без аргументов — все сервисы, последние 100 строк.
#   Примеры: deploy/logs.sh app -f      deploy/logs.sh caddy -n 300
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_docker
SERVICES=(); FOLLOW=(); TAIL=100
while [ $# -gt 0 ]; do
  case "$1" in
    -f|--follow) FOLLOW=(--follow) ;;
    -n) shift; TAIL="${1:?после -n нужно число}" ;;
    -*) die "Неизвестная опция $1" ;;
    *) SERVICES+=("$1") ;;
  esac
  shift
done
dc logs --no-color --tail "$TAIL" ${FOLLOW[@]+"${FOLLOW[@]}"} ${SERVICES[@]+"${SERVICES[@]}"}
