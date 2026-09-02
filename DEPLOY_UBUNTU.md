# คู่มือลง Cement Map บน Ubuntu 24.04 LTS

คู่มือนี้ทำสำหรับ VPS Linux เช่น 1 vCPU / RAM 2 GB / SSD 30 GB / Public IPv4

## 1. เข้า VPS

จาก Windows PowerShell:

```powershell
ssh root@IP-VPS
```

ครั้งแรกตอบ:

```text
yes
```

แล้วใส่ Root Password

เมื่อเข้าได้จะเห็นประมาณ:

```text
root@ubuntu:~#
```

## 2. เปลี่ยน Root Password

```bash
passwd
```

## 3. อัปเดต Ubuntu

```bash
apt update && apt upgrade -y
```

## 4. ดึงโปรเจกต์จาก GitHub

```bash
apt install -y git
mkdir -p /var/www
cd /var/www
git clone https://github.com/USERNAME/REPOSITORY.git cementmap
cd cementmap
```

## 5. ติดตั้งระบบอัตโนมัติ

```bash
bash scripts/vps-setup.sh
```

## 6. ตั้ง ADMIN

```bash
nano .env
```

ใส่/แก้:

```env
PORT=3000
HOST=127.0.0.1
SESSION_HOURS=24
CEMENT_ADMIN_USERNAME=admin
CEMENT_ADMIN_PASSWORD=ใส่รหัสของคุณ
# หมายเหตุ: ค่านี้ใช้ตอนสร้าง Admin ครั้งแรกเท่านั้น
PUBLIC_DEMO_MODE=false
DEMO_ROLE=EDITOR
```

บันทึก Nano:

```text
Ctrl + O
Enter
Ctrl + X
```

แล้ว:

```bash
pm2 restart cementmap
pm2 save
```

## 7. ใส่รูป Map

ไฟล์ต้องอยู่:

```text
/var/www/cementmap/public/maps/GTAV_ATLUS_8192x8192.png
```

ถ้าอัป Map ผ่าน GitHub แล้ว `git pull` ลงมา ก็ไม่ต้องทำเพิ่ม

## 8. เช็กเว็บ

```bash
pm2 status
curl http://127.0.0.1:3000/health
```

ดู Log:

```bash
pm2 logs cementmap
```

จาก Browser:

```text
http://IP-VPS
```

## 9. ข้อมูลไม่หายเมื่อ Restart

ข้อมูลอยู่ที่:

```text
/var/www/cementmap/data/store.json
```

ทดสอบได้ด้วย:

```bash
pm2 restart cementmap
```

หรือ:

```bash
reboot
```

หลังเครื่องกลับมา PM2 จะเปิด Cement Map ให้อัตโนมัติ และ `store.json` ยังอยู่บน SSD

## 10. อัปเดตจาก GitHub

```bash
cd /var/www/cementmap
bash scripts/update-from-github.sh
```

อย่าลบโฟลเดอร์โปรเจกต์ทั้งก้อน เพราะ `data/store.json` อยู่ในนั้น

## 11. Backup

สำรองทันที:

```bash
cd /var/www/cementmap
bash scripts/backup-store.sh
```

ดู Backup:

```bash
ls -lh backups/
```

Cron สำรองทุกวันเวลา 04:15 ถูกสร้างโดย `vps-setup.sh`

## 12. ถ้าต้อง Restore

```bash
cd /var/www/cementmap
bash scripts/restore-backup.sh backups/store-YYYYMMDD-HHMMSS.json.gz
```

## คำสั่ง Linux ที่ใช้บ่อย

```bash
pwd                    # ดูว่าอยู่โฟลเดอร์ไหน
ls -la                 # ดูไฟล์
cd /var/www/cementmap  # เข้าโปรเจกต์
nano .env               # แก้ไฟล์
free -h                 # ดู RAM
 df -h                  # ดูพื้นที่ Disk
ip a                    # ดู Network
pm2 status              # ดูสถานะเว็บ
pm2 logs cementmap      # ดู Log
systemctl status nginx  # ดู Nginx
ufw status              # ดู Firewall
```
