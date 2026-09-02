#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

if [[ -x "$APP_DIR/scripts/backup-store.sh" ]]; then
  "$APP_DIR/scripts/backup-store.sh" || true
fi

echo "[update] ดึงโค้ดล่าสุดจาก GitHub..."
git pull --ff-only

echo "[update] ติดตั้ง/อัปเดต dependencies..."
npm install --omit=dev

echo "[update] Restart Cement Map..."
pm2 restart ecosystem.config.cjs --env production
pm2 save

sleep 2
if curl -fsS http://127.0.0.1:3000/health >/dev/null; then
  echo "[update] สำเร็จ: Cement Map online"
else
  echo "[update] เว็บยังตอบ health check ไม่ได้ ดู log ด้วย: pm2 logs cementmap"
  exit 1
fi
