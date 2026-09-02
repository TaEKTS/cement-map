#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "กรุณารันด้วย root: sudo bash scripts/vps-setup.sh"
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "============================================================"
echo " Cement Map - Ubuntu VPS Setup"
echo " App directory: $APP_DIR"
echo "============================================================"

apt update
apt install -y git curl ca-certificates nginx ufw

NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
fi

if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "[setup] ติดตั้ง Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi

npm install -g pm2
npm install --omit=dev

mkdir -p data backups public/maps
chmod +x scripts/*.sh

NEW_ADMIN_PASSWORD=""
if [[ ! -f .env ]]; then
  NEW_ADMIN_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")"
  cat > .env <<ENV
PORT=3000
HOST=127.0.0.1
SESSION_HOURS=24
CEMENT_ADMIN_USERNAME=admin
CEMENT_ADMIN_PASSWORD=$NEW_ADMIN_PASSWORD
PUBLIC_DEMO_MODE=false
DEMO_ROLE=EDITOR
ENV
  chmod 600 .env
fi

if grep -q 'CHANGE_THIS_PASSWORD_NOW' .env 2>/dev/null; then
  echo "[หยุด] .env ยังใช้รหัสตัวอย่าง CHANGE_THIS_PASSWORD_NOW"
  echo "แก้ก่อนด้วย: nano $APP_DIR/.env"
  exit 1
fi

cp nginx/cementmap.conf /etc/nginx/sites-available/cementmap
ln -sfn /etc/nginx/sites-available/cementmap /etc/nginx/sites-enabled/cementmap
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx

pm2 delete cementmap >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup systemd -u root --hp /root >/tmp/cementmap-pm2-startup.log 2>&1 || true
pm2 save

cat > /etc/cron.d/cementmap-backup <<CRON
15 4 * * * root $APP_DIR/scripts/backup-store.sh >>/var/log/cementmap-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/cementmap-backup

SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port / {print $2; exit}')"
SSH_PORT="${SSH_PORT:-22}"
ufw allow "$SSH_PORT/tcp"
ufw allow 'Nginx Full'
ufw --force enable

systemctl restart nginx

sleep 2

echo ""
echo "============================================================"
echo " Setup เสร็จแล้ว"
echo " Node: $(node -v)"
echo " NPM:  $(npm -v)"
echo " PM2:  $(pm2 -v)"
echo " Data: $APP_DIR/data/store.json"
echo " Map:  $APP_DIR/public/maps/GTAV_ATLUS_8192x8192.png"
echo " Backup: ทุกวัน 04:15 เก็บย้อนหลัง 30 วันใน $APP_DIR/backups"
echo "============================================================"
echo ""
if [[ -n "$NEW_ADMIN_PASSWORD" ]]; then
  echo "ADMIN ถูกสร้างอัตโนมัติสำหรับการเปิดครั้งแรก:"
  echo "  Username: admin"
  echo "  Password: $NEW_ADMIN_PASSWORD"
  echo "บันทึกรหัสนี้ไว้ หลังสร้างข้อมูลครั้งแรกให้เปลี่ยนรหัสจากหน้าเว็บ ไม่ใช่แก้ .env"
  echo ""
fi
echo "ดู/แก้ Environment: nano $APP_DIR/.env"
echo "ดูสถานะ: pm2 status"
echo "ดู log:    pm2 logs cementmap"
echo "Health:    curl http://127.0.0.1:3000/health"
echo ""
