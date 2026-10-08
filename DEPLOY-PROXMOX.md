# Instalasi **Fiber Manajement Core** di Proxmox

Panduan langkah-demi-langkah dari **VM kosong di Proxmox** sampai aplikasi bisa
dibuka dari browser. Aplikasi ini sengaja dibuat sangat ringan:

- **Satu proses** (`node server.mjs`) melayani API **dan** tampilan (frontend) — cukup **satu port**.
- **Tanpa dependensi saat runtime** — `server.mjs` hanya memakai modul bawaan Node
  (termasuk database SQLite bawaan `node:sqlite`). Setelah frontend di-build, folder
  `node_modules` tidak diperlukan lagi.
- **Database = satu file** `data/fiberops.db`. Backup cukup dengan menyalin file itu.

> **Syarat wajib: Node.js 22.5 atau lebih baru** (dipakai `node:sqlite`).
> Debian 12 bawaan repo hanya punya Node 18 — jadi Node harus dipasang dari NodeSource
> (ada di Langkah 3).

**Repo kode:** `https://github.com/thiends-88/Fiber-manajement.git`
**Cabang yang dipakai:** `arena/34102c90-fiber-manajement`
(versi Arena ada di cabang ini; setelah PR ke `main` selesai di-merge, clone boleh
memakai cabang `main`.)

---

## Ringkasan langkah

| # | Langkah | Perkiraan waktu |
| - | ------- | --------------- |
| 1 | Buat VM Debian 12 di Proxmox | 10 menit |
| 2 | Install Debian + atur IP statis | 10 menit |
| 3 | Install Node.js 22.5+ | 2 menit |
| 4 | Ambil kode & build aplikasi | 2 menit |
| 5 | Jadwalkan sebagai service (auto-start) | 2 menit |
| 6 | Buka dari browser & login | 1 menit |

**Spesifikasi minimum VM** (nyaman untuk ratusan OLT/ODC/ODP):

| Komponen | Nilai |
| -------- | ----- |
| CPU | 2 core (type `host`) |
| RAM | 2 GB |
| Disk | 20 GB |
| Jaringan | 1 NIC, bridge `vmbr0` |

---

## Langkah 1 — Buat VM di Proxmox (lewat web UI)

1. **Upload ISO Debian 12**
   `Datacenter → pve → local (storage) → ISO Images → Upload` → pilih
   `debian-12.x-amd64-netinst.iso` (dari debian.org).

2. **Create VM** (tombol kanan atas):
   - **General**: VM ID biarkan otomatis, Name: `fiberops`.
   - **OS**: pilih ISO Debian 12 yang baru di-upload.
   - **System**: biarkan default (SCSI Controller: `VirtIO SCSI`).
   - **Disks**: 20 GB, storage `local-lvm`, hapus centang *Skip replication* bila ada.
   - **CPU**: 2 cores, Type: `host`.
   - **Memory**: 2048 MiB (biarkan *Ballooning* aktif).
   - **Network**: Bridge `vmbr0`, Model: `VirtIO (paravirtualized)`.
   - **Confirm**: **hilangkan centang "Start after created"**, lalu Finish.

3. **Start VM** → **Console** (buka dari daftar VM, tombol `>_ Console`).

> Mau lebih ringan? Bisa juga pakai **LXC (container)** Debian 12: `Create CT` →
> Template `debian-12-standard`, 2 GB RAM, 20 GB root disk, lalu lanjut dari Langkah 2
> (langkah-langkah Debian-nya sama).

---

## Langkah 2 — Install Debian 12 + IP statis

Di dalam console VM, ikuti installer Debian:

1. Language: **English** (atau Indonesia kalau tersedia), Keyboard: sesuai.
2. Hostname: `fiberops` · Domain: kosongkan.
3. Root password: **buat password kuat** (catat!).
4. Buat user biasa, mis. `fiberops`.
5. Partition disks: **Guided – use entire disk and set up LVM** → pilih disk virtio
   (`/dev/vda`) → *All files in one partition* → **Finish partitioning and write changes**.
6. Scan extra installation media: **No**.
7. Mirror: country **Indonesia**, `deb.debian.org`; proxy: kosongkan.
8. Popularity contest: **No**.
9. **Software selection**: cukup centang **SSH server** dan **standard system utilities**
   (jangan pilih desktop environment — ini server).
10. Install GRUB: **Yes** → pilih `/dev/vda`.

Setelah reboot, login sebagai `root`, lalu lihat IP:

```bash
ip a          # catat alamat, mis. 192.168.1.55 (interface biasanya ens18)
```

Untuk IP tetap (disarankan, supaya alamat tidak berubah), edit
`/etc/network/interfaces`:

```bash
nano /etc/network/interfaces
```

```text
auto ens18
iface ens18 inet static
    address 192.168.1.50/24
    gateway 192.168.1.1
    dns-nameservers 192.168.1.1 1.1.1.1
```

> Sesuaikan nama interface (`ens18`), IP, dan gateway dengan jaringan Anda.
> Lakukan dari **console Proxmox**, karena koneksi SSH bisa terputus sesaat.

Setelah itu SSH dari komputer Anda lebih nyaman:

```bash
ssh root@192.168.1.50
```

---

## Langkah 3 — Install Node.js 22.5+ (wajib)

Debian 12 bawaan repo punya Node 18 — **terlalu tua**. Pasang dari NodeSource:

```bash
apt-get update
apt-get install -y ca-certificates curl gnupg git

mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list

apt-get update
apt-get install -y nodejs

node -v      # HARUS v22.5.0 atau lebih baru, mis. v22.14.0
```

Kalau `node -v` masih di bawah 22.5, **jangan lanjut** — aplikasi tidak akan bisa
membuka database (`node:sqlite` baru ada sejak Node 22.5).

---

## Langkah 4 — Ambil kode & build

```bash
git clone --depth 1 --branch arena/34102c90-fiber-manajement \
  https://github.com/thiends-88/Fiber-manajement.git /opt/fiberops

cd /opt/fiberops
npm install
npm run build        # menghasilkan folder dist/ (frontend siap pakai)
```

Setelah build sukses, `node_modules` boleh dihapus supaya hemat disk
(aplikasi tidak membutuhkannya saat runtime):

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

Agar aplikasi tetap hidup walau VM restart atau aplikasi error:

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

**Firewall** (kalau di VM ada `ufw`):

```bash
apt-get install -y ufw
ufw allow 22/tcp
ufw allow 8080/tcp
ufw enable
```

Di Proxmox sendiri, firewall default mati. Kalau Anda menyalakannya
(Datacenter → Firewall, atau per-VM di tab Firewall), izinkan **TCP 8080 inbound**
dan **ICMP**.

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

## Opsi lain — Docker (kalau VM/LXC sudah ada Docker)

Bisa juga menjalankan dalam container (gambar sudah tersedia `Dockerfile`):

```bash
git clone --depth 1 --branch arena/34102c90-fiber-manajement \
  https://github.com/thiends-88/Fiber-manajement.git fiberops
cd fiberops

docker build -t fiber-core .
docker run -d \
  --name fiber-core \
  --restart unless-stopped \
  -p 8080:8080 \
  -v fiber-core-data:/app/data \
  fiber-core
```

Data tersimpan di volume `fiber-core-data` (aman walau container dihapus).
Kalau pakai **LXC**, aktifkan dulu `Options → Features → Nesting` pada container.

---

## Update versi nanti

```bash
cd /opt/fiberops
git pull
npm install
npm run build
systemctl restart fiberops
```

Cek hasilnya: `systemctl status fiberops` lalu hard-refresh browser (`Ctrl+Shift+R`).

---

## Backup & restore

Database hanya **satu file**. Backup harian (contoh cron pukul 02:00):

```bash
mkdir -p /backup
crontab -e
# tambahkan baris:
0 2 * * * cp /opt/fiberops/data/fiberops.db /backup/fiberops-$(date +\%Y\%m\%d).db
```

Backup paling aman (selama aplikasi berjalan) memakai `.backup` SQLite:

```bash
apt-get install -y sqlite3
sqlite3 /opt/fiberops/data/fiberops.db ".backup '/backup/fiberops.db'"
```

**Restore**: hentikan service, salin file backup ke `data/fiberops.db`, jalankan lagi:

```bash
systemctl stop fiberops
cp /backup/fiberops-20260101.db /opt/fiberops/data/fiberops.db
chown fiberops:fiberops /opt/fiberops/data/fiberops.db
systemctl start fiberops
```

**Reset ke data demo**: hapus file database, lalu restart — database dibuat &
di-seed otomatis:

```bash
systemctl stop fiberops
rm /opt/fiberops/data/fiberops.db
systemctl start fiberops
```

---

## Reverse proxy + HTTPS (opsional, untuk akses dari internet)

Contoh nginx (jalankan di VM yang sama atau VM terpisah):

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
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d fiber.contoh.id
```

---

## Kalau ada masalah

| Gejala | Penyebab & solusi |
| ------ | ----------------- |
| `node:sqlite` / `DatabaseSync is not defined` | Node < 22.5. Cek `node -v`, pasang ulang dari NodeSource (Langkah 3). |
| Halaman tidak bisa dibuka sama sekali | Service mati: `systemctl status fiberops`, cek `journalctl -u fiberops -f`. Atau port bentrok: ganti `ARENA_API_PORT`. |
| `EADDRINUSE: address already in use` | Port 8080 sudah dipakai proses lain. Cek `ss -ltnp | grep 8080`, ganti port. |
| `EACCES: permission denied … fiberops.db` | Folder `data/` bukan milik user service. Jalankan `chown -R fiberops:fiberops /opt/fiberops`. |
| Halaman tampil versi lama setelah update | Cache browser — hard refresh (`Ctrl+Shift+R`), atau restart nginx/service. |
| `npm run build` gagal (kehabisan memori) | RAM VM terlalu kecil. Tambah swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`. |
| Tidak bisa login | Cek jam/server: token login bergantung pada waktu sistem (`timedatectl`). |

---

## Ringkasan perintah (copy-paste untuk VM Debian 12 yang sudah jalan)

```bash
# 1) Node.js 22.5+
apt-get update && apt-get install -y ca-certificates curl gnupg git
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt-get update && apt-get install -y nodejs && node -v

# 2) Kode + build
git clone --depth 1 --branch arena/34102c90-fiber-manajement https://github.com/thiends-88/Fiber-manajement.git /opt/fiberops
cd /opt/fiberops && npm install && npm run build && rm -rf node_modules

# 3) Service
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

Selesai — buka `http://IP-VM:8080`.
