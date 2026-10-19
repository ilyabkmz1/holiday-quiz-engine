#!/usr/bin/env bash
# Первичная настройка ВМ Ubuntu 24.04 LTS (облачная ВМ, любой провайдер в РФ). Запускать ОДИН РАЗ от root, повторный запуск безопасен.
#   sudo bash bootstrap-vm.sh
# Что делает: обновления, Docker Engine + compose plugin из официального репозитория, пользователь deploy
# (группа docker, ваш SSH-ключ), ufw (22/80/443), fail2ban для ssh, unattended-upgrades, swap 2 ГБ,
# каталоги /opt/quiz, часовой пояс Europe/Moscow, ротация логов Docker.
# Переменные: SSH_ALLOW_FROM=<IP администратора> — открыть 22 только для этого адреса (иначе 22 открыт всем,
#   с лимитом попыток; ограничение по IP всё равно задаётся в группе безопасности облачного провайдера).
set -euo pipefail

DEPLOY_USER=deploy
QUIZ_ROOT=/opt/quiz
SWAP_SIZE_GB=2

log() { printf '\n==> %s\n' "$*"; }
ok() { printf '[ОК] %s\n' "$*"; }
warn() { printf '[ВНИМАНИЕ] %s\n' "$*" >&2; }
die() { printf '[ОШИБКА] %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Запустите от root: sudo bash $0"
[ -r /etc/os-release ] || die "Нет /etc/os-release: система не похожа на Ubuntu."
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = ubuntu ] || die "Скрипт рассчитан на Ubuntu (обнаружено: ${ID:-?})."
[ "${VERSION_ID:-}" = "24.04" ] || warn "Ожидалась Ubuntu 24.04, обнаружена ${VERSION_ID:-?}. Продолжаю, но проверьте результат."
export DEBIAN_FRONTEND=noninteractive

log "1/10. Обновление системы и базовые пакеты"
APT_OPTS=(-o DPkg::Lock::Timeout=300)  # unattended-upgrades при первой загрузке держит блокировку dpkg
apt-get "${APT_OPTS[@]}" update -y
apt-get "${APT_OPTS[@]}" upgrade -y
apt-get "${APT_OPTS[@]}" install -y ca-certificates curl gnupg git ufw fail2ban unattended-upgrades openssl jq
ok "пакеты установлены"

log "2/10. Часовой пояс Europe/Moscow"
timedatectl set-timezone Europe/Moscow
ok "часовой пояс: $(timedatectl show -p Timezone --value)"

log "3/10. Docker Engine и compose plugin (официальный репозиторий Docker)"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.list <<DOCKERLIST
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable
DOCKERLIST
  apt-get "${APT_OPTS[@]}" update -y
  apt-get "${APT_OPTS[@]}" install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Ротация логов по умолчанию для любых контейнеров (в compose она задана и явно).
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'DAEMON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
DAEMON
  systemctl restart docker
fi
systemctl enable --now docker
ok "$(docker --version); $(docker compose version)"

log "4/10. Пользователь $DEPLOY_USER"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
AUTH="/home/$DEPLOY_USER/.ssh/authorized_keys"
if [ ! -s "$AUTH" ]; then
  # Копируем ключ того, кто запустил скрипт (обычно ubuntu, ключ задан при создании ВМ в консоли провайдера).
  SRC=""
  for candidate in "/home/${SUDO_USER:-}/.ssh/authorized_keys" /root/.ssh/authorized_keys /home/ubuntu/.ssh/authorized_keys; do
    if [ -s "$candidate" ]; then SRC="$candidate"; break; fi
  done
  if [ -n "$SRC" ]; then
    cp "$SRC" "$AUTH"
    ok "SSH-ключи скопированы из $SRC"
  else
    warn "Не найден authorized_keys для копирования. Добавьте ключ вручную в $AUTH."
  fi
fi
if [ -f "$AUTH" ]; then chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH"; chmod 600 "$AUTH"; fi
ok "пользователь $DEPLOY_USER в группе docker (без sudo)"

log "5/10. Вход по SSH только по ключам"
if [ -s "$AUTH" ]; then
  cat > /etc/ssh/sshd_config.d/99-quiz.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSHD
  if sshd -t; then systemctl reload ssh; ok "пароли для SSH отключены"; else rm -f /etc/ssh/sshd_config.d/99-quiz.conf; warn "sshd -t выявил ошибку, правка отменена"; fi
else
  warn "У $DEPLOY_USER нет SSH-ключа — отключение паролей пропущено, чтобы не потерять доступ."
fi

log "6/10. Файрвол ufw (22, 80, 443)"
ufw default deny incoming
ufw default allow outgoing
if [ -n "${SSH_ALLOW_FROM:-}" ]; then
  ufw allow from "$SSH_ALLOW_FROM" to any port 22 proto tcp
  ok "SSH разрешён только с $SSH_ALLOW_FROM"
else
  ufw limit 22/tcp
  warn "SSH открыт всем адресам (с лимитом попыток). Ограничьте источник в группе безопасности облачного провайдера."
fi
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
ok "ufw включён. Напоминание: опубликованные порты Docker обходят ufw; в compose наружу публикуются только 80/443."

log "7/10. fail2ban для sshd"
cat > /etc/fail2ban/jail.d/quiz-sshd.local <<'F2B'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
F2B
systemctl enable --now fail2ban
systemctl restart fail2ban
ok "fail2ban активен"

log "8/10. Автоматические обновления безопасности"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'AUTO'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTO
# Автоперезагрузки нет: перезагрузку после обновления ядра выбирает человек (см. deploy/README.md).
ok "unattended-upgrades включены (без автоперезагрузки)"

log "9/10. Swap ${SWAP_SIZE_GB} ГБ"
if swapon --show=NAME --noheadings | grep -q .; then
  ok "swap уже есть: $(swapon --show=NAME,SIZE --noheadings | tr '\n' ' ')"
else
  fallocate -l "${SWAP_SIZE_GB}G" /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_SIZE_GB * 1024))
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "swap создан"
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-quiz-swap.conf
sysctl -p /etc/sysctl.d/99-quiz-swap.conf >/dev/null

log "10/10. Каталоги $QUIZ_ROOT"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$QUIZ_ROOT" "$QUIZ_ROOT/state"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$QUIZ_ROOT/backups"
# Код клонируется в $QUIZ_ROOT/app, секреты лежат в $QUIZ_ROOT/.env (вне git-дерева).
ok "каталоги готовы"

cat <<DONE

==============================================================
Bootstrap завершён. Дальше (под пользователем $DEPLOY_USER):
  1. Откройте НОВУЮ SSH-сессию:  ssh $DEPLOY_USER@<IP>   (группа docker применяется при новом входе)
  2. Проверьте:  docker run --rm hello-world   и   ufw status   и   free -h
  3. Следуйте deploy/README.md с шага «Клонирование репозитория».
Если ядро обновилось, перезагрузите ВМ: sudo reboot (когда стенд не используется).
==============================================================
DONE
