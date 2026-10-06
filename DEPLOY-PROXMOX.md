# Deploy FiberOps Arena di Proxmox

Aplikasi ini dirancang sangat sederhana untuk produksi:

- **Satu proses** (`node server.mjs`) melayani API **dan** frontend hasil build — satu port saja.
- **Tanpa dependensi saat runtime** — `server.mjs` hanya memakai modul bawaan Node
  (termasuk database `node:sqlite`). Setelah frontend di-build, folder `node_modules`
  tidak dibutuhkan lagi.
- **Database = satu file** `data/fiberops.db`. Backup = salin file itu.

> Syarat: **Node.js 22.5+** (untuk `node:sqlite`). Cek dengan `node -v`.

---

## Opsi A — Docker (paling rapi, jalan di VM/LXC yang ada Docker-nya)

```bash
git clone --depth 1 https://github.com/thiends-88/Fiber-manajement.git fiberops
cd fiberops

docker build -t fiberops-arena .

docker run -d \
  --name fiberops \
  --restart unless-stopped \
  -p 8080:8080 \
  -v fiberops-data:/app/data \
  fiberops-arena
```

- Aplikasi: `http://IP-SERVER:8080`
- Data tersimpan di volume `fiberops-data` (awet walau container dihapus).
- Update versi: `git pull && docker build -t fiberops-arena . && docker rm -f fiberops && docker run ...` (ulangi perintah run di atas).

---

## Opsi B — Langsung di VM/LXC (tanpa Docker)

```bash
# 1. Ambil kode (hanya snapshot terbaru, tanpa riwayat lama)
git clone --depth 1 https://github.com/thiends-88/Fiber-manajement.git /opt/fiberops
cd /opt/fiberops

# 2. Build frontend (butuh node_modules hanya untuk tahap ini)
npm install
npm run build

# 3. Jalankan — cukup node, tidak perlu node_modules lagi
ARENA_API_PORT=8080 node server.mjs
```

### Jadikan service systemd (auto-start + auto-restart)

Buat `/etc/systemd/system/fiberops.service`:

```ini
[Unit]
Description=FiberOps Arena
After=network.target

[Service]
WorkingDirectory=/opt/fiberops
ExecStart=/usr/bin/node server.mjs
Environment=ARENA_API_PORT=8080
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Lalu:

```bash
systemctl daemon-reload
systemctl enable --now fiberops
systemctl status fiberops
```

---

## Konfigurasi

| Env var          | Default | Fungsi                        |
| ---------------- | ------- | ----------------------------- |
| `ARENA_API_PORT` | `4500`  | Port HTTP (API + frontend)    |
| `ARENA_API_HOST` | `0.0.0.0` | Interface bind              |

## Backup & reset

- **Backup**: salin `data/fiberops.db` (hentikan proses dulu, atau gunakan `sqlite3 data/fiberops.db ".backup backup.db"` agar aman).
- **Reset ke data demo**: hapus `data/fiberops.db` lalu jalankan ulang — database dibuat & di-seed otomatis.

## Login awal

| Peran    | Email                 | Password    |
| -------- | --------------------- | ----------- |
| admin    | `admin@arena.test`    | `Arena123!` |
| operator | `operator@arena.test` | `Arena123!` |

Segera buat user baru lewat menu **User** dan hapus akun demo bila server dibuka ke publik.

## Reverse proxy (opsional)

Contoh nginx untuk domain + HTTPS:

```nginx
server {
    listen 80;
    server_name fiberops.contoh.id;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
