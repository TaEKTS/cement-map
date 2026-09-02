#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORE="$APP_DIR/data/store.json"
BACKUP_DIR="$APP_DIR/backups"
STAMP="$(date '+%Y%m%d-%H%M%S')"

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$STORE" ]]; then
  echo "[backup] ไม่มี data/store.json จึงยังไม่มีข้อมูลให้สำรอง"
  exit 0
fi

OUT="$BACKUP_DIR/store-$STAMP.json"
cp -a "$STORE" "$OUT"
gzip -f "$OUT"

# Keep 30 days of local backups.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'store-*.json.gz' -mtime +30 -delete

echo "[backup] สำรองแล้ว: $OUT.gz"
