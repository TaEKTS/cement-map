# Cement Map v2.3.0 — GitHub + Ubuntu VPS Ready

เว็บแผนที่ GTA V แบบ Realtime สำหรับจับเวลาปูน ออกแบบให้รันบน Ubuntu VPS ที่มี SSD ถาวร เพื่อให้ User / จุด / กองเวลา / History / Settings ไม่หายเมื่อ Restart หรือ Reboot เครื่อง

## ฟีเจอร์หลัก

- Realtime ด้วย Socket.IO + fallback sync
- แผนที่ GTA V รองรับไฟล์ 8192×8192 และซูมสูงสุด 1500%
- 1 จุดมีหลายกอง/หลายเวลา เช่น `กอง 1`, `กอง 2`, `กอง 3`
- สูงสุด 20 กองต่อจุด
- แต่ละกองตั้งเวลาใหม่ / รอเวลา / เปลี่ยนชื่อ / ลบแยกกันได้
- Marker ของแต่ละจุดแสดงกองที่ถึงเวลาก่อน
- Cluster ตอนซูมออกแสดงเวลาที่น้อยที่สุดของทุกกองในกลุ่ม
- รายการปูนอยู่ด้านซ้ายและเรียง **กองที่ถึงเวลาก่อนขึ้นด้านบน**
- Layout ใช้พื้นที่หน้าจอให้มากที่สุด โดยให้ Map และแผงควบคุมขยายตามจอ
- ไม่มีระบบสมัครสมาชิกเอง
- บัญชี User สร้างโดย ADMIN เท่านั้น
- สิทธิ์ VIEWER / MEMBER / EDITOR / ADMIN
- มี History
- เก็บข้อมูลถาวรใน `data/store.json`
- Atomic save ลดความเสี่ยงไฟล์ข้อมูลเขียนไม่ครบ
- มี PM2 config สำหรับเปิด 24/7
- มี Nginx reverse proxy พร้อม WebSocket
- มีสคริปต์ Backup ทุกวัน และ Update จาก GitHub โดยไม่แตะ `data/store.json`

## สิทธิ์ User

| Role | สิทธิ์ |
|---|---|
| VIEWER | ดู Map / จุด / เวลา |
| MEMBER | ดู + ตั้งเวลาและเปลี่ยนสถานะกอง |
| EDITOR | MEMBER + เพิ่มกอง เพิ่มจุด ย้าย เปลี่ยนชื่อ ลบ |
| ADMIN | ทำได้ทั้งหมด + สร้าง User / ปรับ Role / Reset Password / Settings / History |

## โครงสร้างโปรเจกต์

```text
CementMap/
├─ server.js
├─ package.json
├─ ecosystem.config.cjs
├─ .env.example
├─ .gitignore
├─ README.md
├─ DEPLOY_UBUNTU.md
├─ data/
│  └─ .gitkeep
├─ backups/
│  └─ .gitkeep
├─ nginx/
│  └─ cementmap.conf
├─ scripts/
│  ├─ vps-setup.sh
│  ├─ backup-store.sh
│  ├─ restore-backup.sh
│  └─ update-from-github.sh
└─ public/
   ├─ index.html
   ├─ maps/
   │  ├─ .gitkeep
   │  └─ README.txt
   └─ map-assets/
```

## ใส่ Map GTA V

เอาไฟล์ Map ใส่ที่:

```text
public/maps/GTAV_ATLUS_8192x8192.png
```

ค่าเริ่มต้นของเว็บจะโหลด:

```text
/maps/GTAV_ATLUS_8192x8192.png
```

ถ้าจะใช้ URL ภายนอก สามารถเปลี่ยนใน Settings ของ ADMIN เป็น `https://...` ได้

## อัปขึ้น GitHub

อัป **ไฟล์และโฟลเดอร์ทั้งหมดในชุดนี้** ไปที่ root ของ repository

ห้าม Commit ไฟล์ต่อไปนี้:

```text
.env
data/store.json
backups/*.gz
node_modules/
```

`.gitignore` ในชุดนี้ตั้งไว้ให้แล้ว

## ติดตั้งบน Ubuntu 24.04 LTS

แนะนำวางโปรเจกต์ที่:

```text
/var/www/cementmap
```

ตัวอย่าง:

```bash
apt update && apt upgrade -y
apt install -y git
mkdir -p /var/www
cd /var/www
git clone https://github.com/USERNAME/REPOSITORY.git cementmap
cd cementmap
```

จากนั้นใช้ Setup Script:

```bash
bash scripts/vps-setup.sh
```

Script จะติดตั้ง/ตั้งค่า:

- Git / Curl
- Node.js 22
- Nginx
- UFW
- PM2
- npm dependencies
- Nginx reverse proxy
- PM2 auto-start หลัง Reboot
- Daily backup เวลา 04:15

หลัง Script ทำงาน ให้แก้ `.env`:

```bash
nano .env
```

ตัวอย่าง:

```env
PORT=3000
HOST=127.0.0.1
SESSION_HOURS=24
CEMENT_ADMIN_USERNAME=admin
CEMENT_ADMIN_PASSWORD=ใส่รหัสใหม่อย่างน้อย8ตัว
# หมายเหตุ: ค่านี้ใช้ตอนสร้าง Admin ครั้งแรกเท่านั้น
PUBLIC_DEMO_MODE=false
DEMO_ROLE=EDITOR
```

จากนั้น:

```bash
pm2 restart cementmap
pm2 save
```

## เช็ก Server

```bash
pm2 status
pm2 logs cementmap
curl http://127.0.0.1:3000/health
```

ถ้าปกติ `/health` จะคืน JSON ที่มี `"ok": true`

จากคอมเครื่องอื่น เข้าเว็บด้วย:

```text
http://IP-VPS
```

## ข้อมูลเซฟตรงไหน

ข้อมูลจริงอยู่ที่:

```text
/var/www/cementmap/data/store.json
```

ไฟล์นี้เก็บ:

- User และ Password Hash
- Role
- จุดปูน
- กอง 1 / กอง 2 / กอง 3 ...
- เวลาแต่ละกอง
- Settings
- History

`store.json` ถูก Ignore จาก GitHub จึงไม่ถูก `git pull` ทับ

## อัปเดตเว็บภายหลัง

หลัง Push โค้ดใหม่ขึ้น GitHub ให้รันบน VPS:

```bash
cd /var/www/cementmap
bash scripts/update-from-github.sh
```

สคริปต์จะ:

1. Backup `store.json` ก่อน
2. `git pull --ff-only`
3. `npm install --omit=dev`
4. Restart PM2
5. ตรวจ `/health`

## Backup

Backup เองทันที:

```bash
cd /var/www/cementmap
bash scripts/backup-store.sh
```

ไฟล์จะอยู่ใน:

```text
backups/store-YYYYMMDD-HHMMSS.json.gz
```

ระบบ Setup จะสร้าง Cron สำรองทุกวันเวลา `04:15` และเก็บ local backup ย้อนหลัง 30 วัน

> Local backup ยังอยู่ใน VPS เดียวกัน หาก VPS ถูกลบ/ดิสก์เสีย Backup ก็หายได้ ควรเปิด Daily Backup/Snapshot ของผู้ให้บริการ VPS เพิ่มด้วย

## Restore ข้อมูล

ดูไฟล์ก่อน:

```bash
ls -lh backups/
```

แล้วกู้:

```bash
bash scripts/restore-backup.sh backups/store-YYYYMMDD-HHMMSS.json.gz
```

Script จะ Backup ข้อมูลปัจจุบันก่อน Restore และ Restart Cement Map ให้อัตโนมัติ

## PM2 คำสั่งที่ใช้บ่อย

```bash
pm2 status
pm2 logs cementmap
pm2 restart cementmap
pm2 stop cementmap
pm2 start ecosystem.config.cjs --env production
pm2 save
```

## Nginx

ไฟล์ตัวอย่างอยู่ที่:

```text
nginx/cementmap.conf
```

Nginx รับ Port `80` แล้วส่งเข้า Node.js ที่:

```text
127.0.0.1:3000
```

พร้อมรองรับ Socket.IO WebSocket

## Firewall

Setup Script เปิดเฉพาะ:

- SSH port ของเครื่อง
- Nginx Full (`80/443`)

เช็กได้ด้วย:

```bash
ufw status
```

## RAM 2 GB / SSD 30 GB

สเปกประมาณนี้เพียงพอสำหรับ Cement Map และผู้ใช้หลักสิบคน ตัวภาพ 8K ถูก Decode ที่ Browser ของผู้ใช้เป็นหลัก ไม่ได้ Decode ทั้งภาพใน RAM ของ Node.js Server

PM2 ตั้ง `max_memory_restart` ไว้ที่ 700 MB เพื่อช่วยป้องกัน Node.js กิน RAM ผิดปกติ

## ความปลอดภัยที่ควรทำ

1. เปลี่ยน Root Password ที่ผู้ให้บริการสร้างให้ทันที
2. อย่า Commit `.env`
3. ใช้รหัส ADMIN อย่างน้อย 8 ตัว และไม่ใช้รหัสเดียวกับ Root
4. เมื่อระบบใช้งานนิ่งแล้ว ควรเปลี่ยนจาก SSH Password ไปเป็น SSH Key
5. ถ้ามี Domain ให้เปิด HTTPS ด้วย Certbot/Cloudflare ภายหลัง
6. เปิด Daily Backup/Snapshot ของผู้ให้บริการ VPS

## หมายเหตุเรื่อง GitHub

เวลาจะอัปเดตโค้ด ห้ามใช้วิธีลบ `/var/www/cementmap` ทั้งโฟลเดอร์แล้ว Clone ใหม่ เพราะจะลบ `data/store.json` ไปด้วย

ให้ใช้:

```bash
bash scripts/update-from-github.sh
```

หรืออย่างน้อย:

```bash
git pull
npm install
pm2 restart cementmap
```

เพื่อเก็บข้อมูล runtime เดิมไว้
