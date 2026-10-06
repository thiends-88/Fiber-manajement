# Panduan Deploy FiberOps ke Proxmox dari GitHub

Panduan lengkap untuk meng-update dan menjalankan aplikasi FiberOps di server Proxmox Anda dari repository GitHub.

---

## Prasyarat di Server Proxmox

### 1. Install Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verifikasi:
```bash
node --version   # harus v22.x
npm --version
```

### 2. Install PM2 (process manager)

```bash
sudo npm install -g pm2
```

### 3. Install Nginx (reverse proxy)

```bash
sudo apt-get install -y nginx
```

### 4. Buat folder aplikasi

```bash
sudo mkdir -p /opt/fiberops
sudo chown $USER:$USER /opt/fiberops
mkdir -p /var/log/fiberops
```

---

## Setup Awal (Hanya Sekali)

### Langkah 1 — Clone repository dari GitHub

```bash
cd /opt
git clone https://github.com/USERNAME/fiber-buddy-suite.git fiberops
cd fiberops
```

> Ganti `USERNAME` dengan username GitHub Anda dan `fiber-buddy-suite` dengan nama repo yang benar.

### Langkah 2 — Buat file `.env`

Buat file `.env` di folder `/opt/fiberops` dengan isi yang sama dengan lokal Anda:

```bash
nano /opt/fiberops/.env
```

Isi dengan (gunakan nilai dari project Lovable Anda — lihat file `.env` di lokal):

```env
SUPABASE_PROJECT_ID=xxx
SUPABASE_PUBLISHABLE_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_PROJECT_ID=xxx
VITE_SUPABASE_PUBLISHABLE_KEY=xxx
VITE_SUPABASE_URL=https://xxx.supabase.co
```

Simpan dengan `Ctrl+O`, lalu `Ctrl+X`.

> **Penting:** Nilai-nilai ini ada di file `.env` project lokal Anda. Salin persis. Tanpa ini, aplikasi tidak bisa konek ke database cloud.

### Langkah 3 — Install dependencies

```bash
cd /opt/fiberops
npm install
```

### Langkah 4 — Build untuk Node.js

```bash
npm run build
```

Build ini menghasilkan folder `.output/` yang berisi server siap pakai untuk Node.js.

### Langkah 5 — Jalankan dengan PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # ikuti instruksi yang muncul agar auto-start saat server reboot
```

Cek status:
```bash
pm2 status
pm2 logs fiberops --lines 20
```

### Langkah 6 — Konfigurasi Nginx

Buat config Nginx:

```bash
sudo nano /etc/nginx/sites-available/fiberops
```

Isi dengan:

```nginx
server {
    listen 80;
    server_name fiberops.lokal 192.168.1.100;  # ganti dengan IP/domain Anda

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Aktifkan:

```bash
sudo ln -s /etc/nginx/sites-available/fiberops /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Akses aplikasi di `http://IP-SERVER-ANDA`.

---

## Update Aplikasi (Setiap Kali Ada Perubahan di GitHub)

Ini adalah langkah yang Anda jalankan setiap kali ingin update aplikasi di server Proxmox dengan kode terbaru dari GitHub:

```bash
cd /opt/fiberops

# 1. Tarik kode terbaru dari GitHub
git pull origin main

# 2. Install dependencies (kalau ada paket baru)
npm install

# 3. Build ulang — WAJIB supaya perubahan tampil
npm run build

# 4. Restart aplikasi
pm2 restart fiberops

# 5. Cek apakah jalan normal
pm2 logs fiberops --lines 10
```

> **Catatan:** Kalau `git pull` error karena file `.env` berubah, jalankan `git stash` lalu `git pull`, lalu `git stash pop`.

### Cara cepat — buat script update

Buat file update sekali jalan:

```bash
nano /opt/fiberops/update.sh
```

Isi:

```bash
#!/bin/bash
set -e
cd /opt/fiberops
echo "==> Pull kode terbaru..."
git pull origin main
echo "==> Install dependencies..."
npm install
echo "==> Build ulang..."
npm run build
echo "==> Restart PM2..."
pm2 restart fiberops
echo "==> Selesai! Cek logs:"
pm2 logs fiberops --lines 10 --nostream
```

Jadikan executable:

```bash
chmod +x /opt/fiberops/update.sh
```

Setiap kali mau update, cukup jalankan:

```bash
/opt/fiberops/update.sh
```

---

## Troubleshooting

### Aplikasi tidak bisa diakses

```bash
# Cek PM2 jalan atau tidak
pm2 status

# Cek log error
pm2 logs fiberops --err --lines 30

# Cek port 3000
curl http://127.0.0.1:3000
```

### Build gagal

```bash
# Pastikan Node.js versi 22
node --version

# Hapus node_modules dan install ulang
rm -rf node_modules
npm install
npm run build
```

### Perubahan tidak muncul setelah update

Pastikan Anda menjalankan `npm run build` setelah `git pull`. Tanpa build ulang, server masih menyajikan file lama.

### Database tidak muncul / data kosong

Cek file `.env` — pastikan nilai `SUPABASE_URL` dan `VITE_SUPABASE_URL` sama dengan di lokal. Kalau berbeda, aplikasi konek ke database yang berbeda.

### Port 3000 sudah dipakai

Edit `ecosystem.config.cjs`, ganti `PORT: 3000` ke port lain (misal `3001`), lalu update Nginx proxy_pass juga.

---

## Perintah PM2 yang berguna

```bash
pm2 status                    # lihat status semua aplikasi
pm2 logs fiberops             # lihat log real-time
pm2 logs fiberops --err       # lihat error saja
pm2 restart fiberops          # restart aplikasi
pm2 stop fiberops             # stop aplikasi
pm2 delete fiberops           # hapus dari PM2
pm2 monit                     # dashboard monitoring
```

---

## Struktur file deploy

```
/opt/fiberops/
├── .env                    # konfigurasi database (TIDAK boleh di-commit)
├── .output/                # hasil build (dibuat otomatis oleh npm run build)
│   └── server/
│       └── index.mjs       # server entry — dijalankan oleh PM2
├── ecosystem.config.cjs    # konfigurasi PM2
├── update.sh               # script update sekali jalan
├── package.json
├── vite.config.ts
└── src/
    └── ...                 # kode sumber
```

---

## Alternatif: Deploy dengan Docker

Kalau Anda lebih suka pakai Docker di Proxmox:

### 1. Buat Dockerfile

Sudah disediakan di project (`Dockerfile`).

### 2. Build dan jalankan

```bash
cd /opt/fiberops
git pull origin main
docker build -t fiberops .
docker run -d --name fiberops --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  fiberops
```

### Update dengan Docker

```bash
cd /opt/fiberops
git pull origin main
docker build -t fiberops .
docker stop fiberops && docker rm fiberops
docker run -d --name fiberops --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  fiberops
```
