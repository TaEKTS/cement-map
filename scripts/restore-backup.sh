#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORE="$APP_DIR/data/store.json"

if [[ $# -ne 1 ]]; then
  echo "ใช้: $0 backups/store-YYYYMMDD-HHMMSS.json.gz"
  exit 1
fi

BACKUP="$1"
if [[ ! -f "$BACKUP" ]]; then
  BACKUP="$APP_DIR/$1"
fi
if [[ ! -f "$BACKUP" ]]; then
  echo "ไม่พบไฟล์ backup"
  exit 1
fi

mkdir -p "$APP_DIR/data"
"$APP_DIR/scripts/backup-store.sh" || true
pm2 stop cementmap || true

tmp="$(mktemp)"
gzip -dc "$BACKUP" > "$tmp"
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));" "$tmp"
mv "$tmp" "$STORE"

pm2 start ecosystem.config.cjs --env production
pm2 save

echo "กู้ข้อมูลจาก $BACKUP สำเร็จ"
