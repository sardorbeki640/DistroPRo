#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 22.04/24.04 server (Oracle Cloud Always Free, ARM or x86) for Distro Pro.
# Run as the default "ubuntu" user:  bash server-setup.sh <domain>
#   <domain>: e.g. 141-147-10-20.sslip.io (free, needs no registration; points to the server IP).
# Installs Node 24, Caddy (automatic HTTPS), a "distro" system user, the systemd service and the firewall rules.
# Safe to run again: every step checks what is already there.
set -euo pipefail

DOMAIN="${1:?Domen kerak, masalan: 141-147-10-20.sslip.io}"
APP=/opt/distro-pro/app
DATA=/opt/distro-pro/data

echo "== Tizim paketlari"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates gnupg sqlite3 debian-keyring debian-archive-keyring apt-transport-https iptables-persistent
sudo timedatectl set-timezone Asia/Tashkent

echo "== Node.js 24"
if ! node -v 2>/dev/null | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "== Caddy (HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

echo "== Foydalanuvchi va papkalar"
id distro >/dev/null 2>&1 || sudo useradd --system --create-home --home-dir /opt/distro-pro --shell /usr/sbin/nologin distro
sudo mkdir -p "$APP" "$DATA"
sudo chown -R distro:distro /opt/distro-pro
sudo chmod 750 /opt/distro-pro "$DATA"
# The admin user (ubuntu) may read backups over scp; the data stays closed to everyone else.
sudo usermod -aG distro "$USER"

echo "== systemd xizmati"
sudo tee /etc/systemd/system/distro-pro.service >/dev/null <<UNIT
[Unit]
Description=Distro Pro moliya tizimi
After=network-online.target
Wants=network-online.target

[Service]
User=distro
Group=distro
WorkingDirectory=$APP
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3100
Environment=TRUST_PROXY=1
Environment=FINANCE_DATA_DIR=$DATA
ExecStart=/usr/bin/node --env-file-if-exists=$DATA/.env.local dist/server.cjs
Restart=always
RestartSec=5
# Pending changes are written and the database closed on stop (SIGTERM handler in server.ts).
TimeoutStopSec=20
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/opt/distro-pro

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable distro-pro >/dev/null

echo "== Caddy sozlamasi: https://$DOMAIN"
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:3100
  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options nosniff
    Referrer-Policy same-origin
  }
}
CADDY
sudo systemctl reload caddy || sudo systemctl restart caddy

echo "== Brandmauer: 80 va 443 portlar (Oracle Ubuntu tasviri ularni yopib qo'yadi)"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport $port -m state --state NEW -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 5 -p tcp --dport $port -m state --state NEW -j ACCEPT
done
sudo netfilter-persistent save >/dev/null

echo
echo "Tayyor. Endi kompyuterdan deploy.ps1 bilan dasturni yuklang."
echo "Eslatma: Oracle konsolida (VCN > Security List) 80 va 443 portlar uchun Ingress qoidasi ham bo'lishi kerak."
