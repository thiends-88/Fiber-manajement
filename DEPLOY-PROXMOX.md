# Instalasi **Fiber Manajement Core** di Proxmox (LXC Ubuntu 24.04)

Panduan langkah-demi-langkah dari **LXC container kosong di Proxmox** sampai
aplikasi bisa dibuka dari browser. Aplikasi ini sengaja dibuat sangat ringan:

- **Satu proses** (`node server.mjs`) melayani API **dan** tampilan (frontend) — cukup **satu port**.
- **Tanpa dependensi saat runtime** — `server.mjs` hanya memakai modul bawaan Node
  (termasuk database SQLite bawaan `node:sqlite`). Setelah frontend di-build, folder
  `node_modules` tidak diperlukan lagi.
- **Database = satu file** `data/fiberops.db`. Backup cukup dengan menyalin file itu.

> **Syarat wajib: Node.js 22.5 atau lebih baru** (dipakai `node:sqlite`).
> Ubuntu 24.04 dari repo apt hanya punya Node **18.19.1** — **terlalu tua**, jadi Node
> harus dipasang dari NodeSource (Langkah 3). Jangan pakai `apt install nodejs` saja.

**Repo kode:** `https://github.com/thiends-88/Fiber-manajement.git`
**Cabang yang dipakai:** `arena/34102c90-fiber-manajement`
(versi Arena ada di cabang ini; setelah PR ke `main` selesai di-merge, clone boleh
memakai cabang `main`.)

---

## Ringkasan langkah

| # | Langkah | Perkiraan waktu |
| - | ------- | --------------- |
| 1 | Buat LXC container Ubuntu 24.04 di Proxmox | 5 menit |
| 2 | Update sistem + IP statis + SSH | 5 menit |
| 3 | Install Node.js 22.5+ | 2 menit |
| 4 | Ambil kode & build aplikasi | 2 menit |
| 5 | Jadwalkan sebagai service (auto-start) | 2 menit |
| 6 | Buka dari browser & login | 1 menit |

**Spesifikasi minimum container** (nyaman untuk ratusan OLT/ODC/ODP):

| Komponen | Nilai |
| -------- | ----- |
| CPU | 2 core |
| RAM | 2 GB (swap = 0; kalau nanti kurang, naikkan di Proxmox) |
| Disk | 20 GB root disk |
| Jaringan | 1 NIC, bridge `vmbr0` |

---

## Langkah 1 — Buat LXC container Ubuntu 24.04 (lewat web UI Proxmox)

1. **Unduh template Ubuntu 24.04**
   `Datacenter → pve → local (storage) → CT Templates → Templates` → cari
   **`ubuntu-24.04-standard`** → **Download**.
   (Dari shell Proxmox: `pveam update && pveam download local ubuntu-24.04-standard_24.04-2_amd64.tar.zst`)

2. **Create CT** (tombol kanan atas):
   - **General**: CT ID biarkan otomatis, **Hostname**: `fiberops`,
     **Password**: buat password root (catat!), biarkan *Unprivileged* tercentang
     (lebih aman; aplikasi ini tetap jalan normal).
   - **Template**: pilih `ubuntu-24.04-standard_…` yang baru diunduh.
   - **Disks**: 20 GB, storage `local-lvm`.
   - **CPU**: 2 cores.
   - **Memory**: 2048 MB, **Swap**: 0.
   - **Network**: IPv4 `DHCP` (bisa juga langsung Static, lihat Langkah 2),
     Gateway kosong dulu, Bridge `vmbr0`, IPv6 kosongkan.
   - **DNS**: default (akan pakai DNS dari DHCP).
   - **Confirm**: centang **Start after created** → Finish.

3. **Buka console container**
   Pilih CT `fiberops` → **`>_ Console`** → login `root` dengan password tadi.

> **Catatan:** container Ubuntu **tidak punya SSH** secara default. Setelah itu di
> Langkah 2, SSH dipasang supaya Anda bisa mengakses dari komputer sendiri.

---

## Langkah 2 — Update sistem, IP statis, dan SSH

Jalankan di console (atau SSH setelah terpasang):

```bash
apt update && apt upgrade -y
apt install -y curl ca-certificates gnupg git openssh-server
```

### IP statis (disarankan)

Lihat nama interface dulu:

```bash
ip a          # biasanya eth0 di LXC
```

Edit file netplan (nama file bisa berbeda, cek dengan `ls /etc/netplan/`):

```bash
nano /etc/netplan/50-cloud-init.yaml
```

```yaml
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: no
      addresses:
        - 192.168.1.50/24
      routes:
        - to: default
          via: 192.168.1.1
      nameservers:
        addresses: [192.168.1.1, 1.1.1.1]
```

Terapkan:

```bash
chmod 600 /etc/netplan/50-cloud-init.yaml   # WAJIB: netplan menolak file yang izinnya terbuka
netplan apply
ip a                                          # pastikan 192.168.1.50 muncul
```

> Ganti `eth0`, `192.168.1.50/24`, dan `192.168.1.1` sesuai jaringan Anda.
> Lakukan dari **console Proxmox**, karena koneksi bisa terputus sesaat.
>
> Supaya Proxmox juga tahu IP-nya (biasanya untuk firewall & tampilan di UI),
> jalankan di **shell Proxmox** (bukan di dalam container):
> ```bash
> pct set <CT-ID> --net0 name=eth0,bridge=vmbr0,ip=192.168.1.50/24,gw=192.168.1.1
> ```

Sekarang SSH dari komputer Anda:

```bash
ssh root@192.168.1.50
```

---

## Langkah 3 — Install Node.js 22.5+ (wajib)

Ubuntu 24.04 dari apt hanya punya Node 18.19.1 — **tidak bisa dipakai** karena
aplikasi memakai `node:sqlite` yang baru ada sejak Node 22.5. Pasang dari NodeSource:

```bash
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list

apt update
apt install -y nodejs

node -v      # HARUS v22.5.0 atau lebih baru, mis. v22.14.0
```

Kalau `node -v` masih di bawah 22.5, **jangan lanjut** — aplikasi tidak akan bisa
membuka database.

---

## Langkah 4 — Ambil kode & build

```bash
git clone --depth 1 --branch arena/34102c90-fiber-manajement \
  https://github.com/thiends-88/Fiber-manajement.git /opt/fiberops

cd /opt/fiberops
npm install
npm run build        # menghasilkan folder dist/ (frontend siap pakai)
```

Setelah build sukses, `node_modules` boleh dihapus supaya hemat disk:

```bash
rm -rf node_modules
```

Coba jalankan dulu untuk memastikan beres:

```bash
ARENA_API_PORT=8080 node server.mjs
```

Buka `http://192.168.1.50:8080` — kalau halaman login muncul, berhasil.
Hentikan dengan `Ctrl+C`, lalu lanjut ke Langkah 5 agar jalan otomatis.

---

## Langkah 5 — Jadikan service systemd (auto-start + auto-restart)

```bash
# user khusus (lebih aman daripada root)
useradd --system --home /opt/fiberops --shell /usr/sbin/nologin fiberops
chown -R fiberops:fiberops /opt/fiberops

cat > /etc/systemd/system/fiberops.service <<'EOF'
[Unit]
Description=Fiber Manajement Core (API + frontend)
After=network.target

[Service]
Type=simple
User=fiberops
Group=fiberops
WorkingDirectory=/opt/fiberops
Environment=ARENA_API_PORT=8080
Environment=ARENA_API_HOST=0.0.0.0
Environment=ARENA_DB_PATH=/opt/fiberops/data/fiberops.db
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now fiberops
systemctl status fiberops      # harus "active (running)"
```

Lihat log kalau ada masalah:

```bash
journalctl -u fiberops -f
```

---

## Langkah 6 — Akses & login

| Peran    | Email                 | Password    |
| -------- | --------------------- | ----------- |
| admin    | `admin@arena.test`    | `Arena123!` |
| operator | `operator@arena.test` | `Arena123!` |

Buka `http://192.168.1.50:8080`, login sebagai **admin**, lalu segera buat user baru
lewat menu **User** dan hapus akun demo bila server bisa diakses orang lain.

**Firewall di dalam container** (opsional):

```bash
apt install -y ufw
ufw allow 22/tcp
ufw allow 8080/tcp
ufw enable
```

Di Proxmox, firewall default mati. Kalau dinyalakan (Datacenter → Firewall, atau
per-CT di tab Firewall), izinkan **TCP 8080 inbound**.

---

## Alternatif: VM Debian 12 (bukan LXC)

Kalau lebih suka VM penuh, langkahnya sama, hanya beda di:

| Bagian | LXC Ubuntu 24.04 | VM Debian 12 |
| ------ | ---------------- | ------------ |
| Pembuatan | Create CT + template | Create VM + ISO netinst |
| Jaringan | netplan (`/etc/netplan/*.yaml`, `netplan apply`) | `/etc/network/interfaces` (ifupdown) |
| SSH | `apt install -y openssh-server` | dipilih saat install Debian |

---

## Konfigurasi (opsional)

| Env var          | Default                          | Fungsi |
| ---------------- | -------------------------------- | ------ |
| `ARENA_API_PORT` | `4500`                           | Port HTTP (API + frontend) |
| `ARENA_API_HOST` | `0.0.0.0`                        | Interface yang dipakai |
| `ARENA_DB_PATH`  | `/opt/fiberops/data/fiberops.db` | Lokasi file database |

Ubah port dengan mengedit `/etc/systemd/system/fiberops.service`
(baris `Environment=ARENA_API_PORT=…`), lalu:

```bash
systemctl daemon-reload && systemctl restart fiberops
```

---

## Opsi lain — Docker di dalam LXC

Kalau mau memakai Docker (bukan Node langsung):

1. Di Proxmox: pilih CT → **Options → Features → Edit** → centang **Nesting** → OK,
   lalu restart CT.
2. Di dalam container:

```bash
apt install -y docker.io
systemctl enable --now docker

git clone --depth 1 --branch arena/34102c90-fiber-manajement \
  https://github.com/thiends-88/Fiber-manajement.git /opt/fiberops
cd /opt/fiberops

docker build -t fiber-core .
docker run -d \
  --name fiber-core \
  --restart unless-stopped \
  -p 8080:8080 \
  -v fiber-core-data:/app/data \
  fiber-core
```

---

## Update versi nanti

```bash
cd /opt/fiberops
git pull
npm install
npm run build
systemctl restart fiberops
```

Cek hasilnya: `systemctl status fiberops`, lalu hard-refresh browser (`Ctrl+Shift+R`).

---

## Backup & restore

### 1) Backup file database (paling sederhana)

```bash
mkdir -p /backup
crontab -e
# tambahkan baris (backup tiap hari jam 02:00):
0 2 * * * cp /opt/fiberops/data/fiberops.db /backup/fiberops-$(date +\%Y\%m\%d).db
```

Backup paling aman **selama aplikasi berjalan** memakai `.backup` SQLite:

```bash
apt install -y sqlite3
sqlite3 /opt/fiberops/data/fiberops.db ".backup '/backup/fiberops.db'"
```

**Restore:**

```bash
systemctl stop fiberops
cp /backup/fiberops-20260101.db /opt/fiberops/data/fiberops.db
chown fiberops:fiberops /opt/fiberops/data/fiberops.db
systemctl start fiberops
```

**Reset ke data demo** (database dibuat & di-seed otomatis):

```bash
systemctl stop fiberops
rm /opt/fiberops/data/fiberops.db
systemctl start fiberops
```

### 2) Backup seluruh container lewat Proxmox

```bash
# dari shell Proxmox, ganti 100 dengan CT ID Anda:
vzdump 100 --mode snapshot --storage local
```

Atau lewat UI: `Datacenter → Backup → Backup Now` → pilih CT `fiberops` →
Mode **Snapshot** → Backup. Restore dari tab **Backup** Proxmox.

Salin file keluar-masuk cepat tanpa backup penuh:

```bash
# dari shell Proxmox:
pct pull 100 /opt/fiberops/data/fiberops.db ./fiberops.db   # ambil backup
pct push 100 ./fiberops.db /opt/fiberops/data/fiberops.db   # pulihkan
```

---

## Reverse proxy + HTTPS (opsional, untuk akses dari internet)

Contoh nginx (bisa dijalankan di container yang sama):

```nginx
server {
    listen 80;
    server_name fiber.contoh.id;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # supaya versi baru langsung terbaca setelah update (jangan cache HTML)
    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
```

Aktifkan lalu pasang sertifikat gratis:

```bash
ln -s /etc/nginx/sites-available/fiber /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d fiber.contoh.id
```

---

## Kalau ada masalah

| Gejala | Penyebab & solusi |
| ------ | ----------------- |
| `node:sqlite` / `DatabaseSync is not defined` | Node < 22.5. Cek `node -v`, pasang ulang dari NodeSource (Langkah 3). |
| `apt install nodejs` memasang versi 18 | Repo NodeSource belum aktif / belum `apt update`. Ulangi Langkah 3, lalu `apt policy nodejs`. |
| Netplan mengeluh *"Permissions … too open"* | `chmod 600 /etc/netplan/*.yaml` lalu `netplan apply`. |
| Container kehilangan jaringan setelah `netplan apply` | Salah nama interface/gateway. Pulihkan dari **console Proxmox** (bukan SSH). |
| `EADDRINUSE: address already in use` | Port 8080 sudah dipakai. Cek `ss -ltnp | grep 8080`, ganti `ARENA_API_PORT`. |
| `EACCES: permission denied … fiberops.db` | Folder `data/` bukan milik user service: `chown -R fiberops:fiberops /opt/fiberops`. |
| `npm run build` gagal / kehabisan memori | RAM container kurang. Naikkan dari Proxmox: `pct set <CT-ID> --memory 4096` lalu restart CT (LXC tidak punya swap sendiri). |
| Halaman tampil versi lama setelah update | Cache browser — hard refresh (`Ctrl+Shift+R`). |
| Tidak bisa login | Cek waktu sistem container: `timedatectl` (token login bergantung pada waktu). |
| Perlu fitur khusus (Docker, mount, NFS) di LXC | Nyalakan di Proxmox: CT → **Options → Features** → centang **Nesting** / **NFS** sesuai kebutuhan. |

---

## Ringkasan perintah (copy-paste untuk LXC Ubuntu 24.04)

```bash
# 1) Sistem dasar
apt update && apt upgrade -y
apt install -y curl ca-certificates gnupg git openssh-server

# 2) Node.js 22.5+
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt update && apt install -y nodejs && node -v

# 3) Kode + build
git clone --depth 1 --branch arena/34102c90-fiber-manajement https://github.com/thiends-88/Fiber-manajement.git /opt/fiberops
cd /opt/fiberops && npm install && npm run build && rm -rf node_modules

# 4) Service
useradd --system --home /opt/fiberops --shell /usr/sbin/nologin fiberops
chown -R fiberops:fiberops /opt/fiberops
cat > /etc/systemd/system/fiberops.service <<'EOF'
[Unit]
Description=Fiber Manajement Core (API + frontend)
After=network.target

[Service]
Type=simple
User=fiberops
Group=fiberops
WorkingDirectory=/opt/fiberops
Environment=ARENA_API_PORT=8080
Environment=ARENA_API_HOST=0.0.0.0
Environment=ARENA_DB_PATH=/opt/fiberops/data/fiberops.db
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now fiberops && systemctl status fiberops
```

Selesai — buka `http://IP-CONTAINER:8080`.
