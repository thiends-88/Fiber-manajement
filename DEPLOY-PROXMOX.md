# Deployment & update aman di Proxmox

Aplikasi ini mendokumentasikan jaringan secara **manual**, bukan melakukan SSH/SNMP/discovery atau pemantauan optik langsung. ZTE C300/C320 memakai posisi shelf/slot/port; perangkat fixed-port/manual, termasuk HSGQ, dicatat sesuai perangkat sebenarnya.

> **Sebelum update:** pastikan perubahan yang diinginkan sudah di-review dan di-merge ke versi deployment. Jangan menganggap `main` sudah berisi PR yang masih terbuka. Panduan ini bukan pernyataan bahwa server Proxmox Anda sudah diperiksa.

## Hal penting yang berubah

- Gunakan **Node 22.13+** (diuji pada 22.22.3); Node 22.x terbaru disarankan. Node 18/20 tidak memiliki runtime SQLite yang dibutuhkan aplikasi ini.
- Produksi wajib memakai **`NODE_ENV=production`**. Database/path volume yang hilang, database tanpa pengguna, atau build yang hilang membuat startup **berhenti**, bukan membuat inventaris/akun demo.
- Password pabrik `Arena123!` **tidak dapat dipakai di produksi**; sesi akun yang masih memakai password itu juga diblokir. Buat admin pribadi atau rotasi password **sebelum restart produksi**. Password tidak perlu dan jangan dikirim ke chat.
- Upgrade keamanan mencabut semua sesi lama **satu kali**. Semua pengguna perlu **hard-refresh (`Ctrl+Shift+R`) sebelum login ulang**. Sesi baru tidak dicabut pada setiap restart.
- Database memakai **WAL**: `cp fiberops.db` ketika aplikasi aktif **bukan backup lengkap**. Gunakan snapshot SQLite yang konsisten atau backup seluruh direktori data **setelah semua penulis dihentikan**.
- Jangan hapus database untuk memperbaiki login, jangan menjalankan dua server pada DB yang sama, dan jangan memakai `docker compose down -v`/`docker volume rm` untuk update.
- Migrasi mempertahankan ID inventaris dan tidak membuat pemetaan interface dari kemiripan nama/keanggotaan feeder. Receiver ODC yang belum diketahui tetap perlu pemeriksaan lapangan. Catatan/kolom pengukuran legacy tidak dibuang otomatis; keberadaannya tidak berarti fitur monitoring aktif.

**Pilih sesuai instalasi Anda:**

| Cara berjalan | Periksa | Data yang harus dipertahankan |
| --- | --- | --- |
| Node native/systemd | `systemctl status fiberops` | `ARENA_DB_PATH` pada service, umumnya `/opt/fiberops/data/fiberops.db` |
| Docker | `docker ps -a` dan `docker inspect fiber-core` | Mount yang menuju `/app/data`; **verifikasi nama volume/path sebenarnya**, jangan menebak |

## A. Instalasi native baru — LXC Ubuntu 24.04

### A1. Container dan Node

Buat **unprivileged LXC** Ubuntu 24.04. Contoh alokasi awal: 2 CPU, RAM 2 GB, disk 20 GB. Ini bukan hasil uji kapasitas produksi; ukur penggunaan dan ruang backup Anda. Atur IP/gateway/bridge sesuai jaringan melalui Proxmox; gunakan console saat mengubah jaringan. Batasi SSH dengan firewall dan gunakan kunci SSH.

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg git sqlite3 openssh-server
```

Pasang Node 22.x dari sumber tepercaya. Contoh repository NodeSource (tinjau kebijakan paket/key di lingkungan Anda):

```bash
sudo install -d -m 755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' \
  | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
sudo apt update && sudo apt install -y nodejs
node -v
npm -v
```

**Berhenti jika Node di bawah 22.13.** Aplikasi tidak membutuhkan database eksternal; SQLite disertakan Node. Jangan menjalankan install script dari sumber yang tidak diperiksa sebagai root.

### A2. Kode, build dan direktori data

Jalankan Git/npm dengan akun pemelihara kode, bukan dengan akun service. Contoh berikut mengasumsikan `/opt/fiberops` belum ada. Untuk instalasi yang sudah ada, gunakan **bagian B**, bukan clone/seed ulang.

```bash
sudo install -d -o "$USER" -g "$(id -gn)" -m 755 /opt/fiberops
umask 022
git clone https://github.com/thiends-88/Fiber-manajement.git /opt/fiberops
cd /opt/fiberops
# Pastikan revision/branch deployment Anda sudah memuat perubahan yang disetujui.
git log -1 --oneline
npm ci
npm run build

sudo useradd --system --home /opt/fiberops --shell /usr/sbin/nologin fiberops
sudo install -d -o fiberops -g fiberops -m 700 /opt/fiberops/data
```

Kode/dist harus dapat **dibaca** akun service; akun service cukup diberi hak tulis ke `data/`, bukan seluruh kode. Runtime tidak memerlukan `node_modules`; tidak perlu menghapusnya untuk melakukan update.

### A3. Buat admin pribadi secara lokal

Bash interaktif; masukkan password unik minimal 12 karakter **langsung di terminal server**. Jangan menulis password di argv, file Git, history, atau memakai `set -x`.

```bash
cd /opt/fiberops
read -r -s -p 'Password admin baru (min. 12 karakter): ' ADMIN_PASS; printf '\n'
printf '%s' "$ADMIN_PASS" | sudo -u fiberops env \
  ARENA_DB_PATH=/opt/fiberops/data/fiberops.db \
  /usr/bin/node scripts/create-admin.mjs admin@domain-anda.id
unset ADMIN_PASS
```

Ganti email contoh. Script tidak menimpa akun lama dan tidak membuat perangkat demo. Jika email sudah ada dan memang perlu mengubah password, gunakan **`scripts/set-password.mjs`**, dengan cara stdin yang sama. Rotasi mempertahankan ID/email/nama/role, mencabut sesi akun itu, dan memerlukan restart jika status blokir akun sebelumnya sudah dimuat server.

### A4. Konfigurasi produksi & systemd

Contoh memakai reverse proxy HTTPS pada container yang sama. **Sesuaikan domain** dan pertahankan port lama jika reverse proxy Anda sudah memakai port berbeda.

```bash
sudo install -d -m 700 /etc/fiberops
sudo tee /etc/fiberops/fiberops.env >/dev/null <<'EOF'
NODE_ENV=production
ARENA_API_PORT=8080
ARENA_API_HOST=127.0.0.1
ARENA_DB_PATH=/opt/fiberops/data/fiberops.db
ARENA_PUBLIC_ORIGIN=https://fiber.domain-anda.id
ARENA_SECURE_COOKIES=1
ARENA_TRUSTED_PROXY_IPS=127.0.0.1,::1
EOF
sudo chmod 600 /etc/fiberops/fiberops.env
```

`ARENA_PUBLIC_ORIGIN` adalah origin HTTP/HTTPS **tanpa path/query/kredensial**. Environment file dibaca systemd, bukan otomatis oleh perintah Node dari shell.

```ini
# /etc/systemd/system/fiberops.service
[Unit]
Description=Fiber Manajement Core
After=network.target

[Service]
Type=simple
User=fiberops
Group=fiberops
WorkingDirectory=/opt/fiberops
EnvironmentFile=/etc/fiberops/fiberops.env
ExecStart=/usr/bin/node /opt/fiberops/server.mjs
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/opt/fiberops/data
Restart=on-failure
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

Simpan unit tersebut dengan `sudo nano /etc/systemd/system/fiberops.service`, lalu:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fiberops
sudo systemctl status fiberops --no-pager
curl --retry 10 --retry-delay 1 --retry-connrefused --fail http://127.0.0.1:8080/healthz
sudo -u fiberops node /opt/fiberops/scripts/preflight.mjs /opt/fiberops/data/fiberops.db
```

`/healthz` hanya membuktikan proses merespons; bukan bukti inventaris, TLS, atau seluruh UI benar. Lanjutkan HTTPS di bagian E dan checklist F sebelum digunakan operator.

**Jika hanya LAN/VPN tanpa domain/TLS:** gunakan origin yang benar, misalnya `http://192.168.1.50:8080`, `ARENA_SECURE_COOKIES=0`, bind ke IP LAN/`0.0.0.0` sesuai kebutuhan, dan kosongkan trusted proxy jika diakses langsung. Batasi port hanya untuk subnet/VPN yang berwenang. HTTP mengirim kredensial/token tanpa enkripsi transport; jangan buka konfigurasi ini ke internet. HTTPS tetap disarankan.

## B. Update native yang sudah berjalan

**Kerjakan pada maintenance window. Jangan izinkan pencatatan lapangan selama backup/update/rollback.** Catat DB/path, unit, environment dan port sebenarnya. Simpan konfigurasi lama di lokasi privat. Pastikan tracked code bersih; jangan menimpa perubahan lokal.

### B1. Backup konsisten sebelum mengambil perubahan

Bagian ini sengaja memakai CLI SQLite, karena versi lama mungkin belum memiliki script backup baru.

```bash
set -euo pipefail
cd /opt/fiberops
git status --short
if [ -n "$(git status --porcelain)" ]; then echo 'TUNDA: simpan/tinjau perubahan lokal; jangan reset --hard.'; exit 1; fi
BEFORE=$(git rev-parse HEAD)
DB=/opt/fiberops/data/fiberops.db  # cocokkan dengan service/volume sebenarnya
sudo test -f "$DB"
sudo systemctl stop fiberops
if sudo systemctl is-active --quiet fiberops; then echo 'TUNDA: service masih aktif'; exit 1; fi
sudo install -d -o fiberops -g fiberops -m 700 /backup/fiberops
STAMP=$(date +%Y%m%d-%H%M%S)
BKP=/backup/fiberops/before-update-$STAMP.db
sudo -u fiberops sqlite3 -readonly -cmd '.timeout 10000' "$DB" ".backup '$BKP'"
printf '%s\n' "$BEFORE" | sudo -u fiberops tee "${BKP%.db}.commit.txt" >/dev/null
sudo chmod 600 "$BKP" "${BKP%.db}.commit.txt"
sudo -u fiberops sqlite3 -readonly "$BKP" 'PRAGMA quick_check; PRAGMA foreign_key_check;'
```

Output terakhir harus **`ok` tanpa baris foreign-key error**. Cocokkan juga isi/jumlah inventaris sumber dengan catatan sebelum update; `quick_check=ok` tidak membuktikan Anda memilih database yang benar. Jika backup gagal atau DB path salah, **jangan lanjut**. Simpan salinan backup di luar LXC; backup di disk yang sama tidak melindungi dari kerusakan disk. Snapshot/backup Proxmox berguna sebagai lapisan kedua; konsistensi database tetap harus dijaga, dan backup harus mencakup volume data/bind mount sebenarnya.

### B2. Ambil kode yang sudah disetujui, build, periksa data

```bash
cd /opt/fiberops
git pull --ff-only origin main
# Pastikan revision ini memang memuat PR/release yang disetujui.
git log -1 --oneline
npm ci
npm run build
sudo -u fiberops node scripts/preflight.mjs "$DB"
```

**Jika preflight gagal, jangan menyalakan produksi dulu.** Pengecekan tidak memodifikasi DB. Tabel fitur yang belum ada pada versi lama dapat muncul sebagai peringatan migrasi; FK rusak, posisi card ganda, port di luar kapasitas dan admin tidak aman perlu ditangani sebelum melanjutkan. Jangan menghapus/mengganti ID otomatis untuk menghilangkan pesan error.

Jika penghalang hanya password pabrik/ketiadaan admin pribadi:

1. Buat admin pribadi dengan A3 bila belum ada.
2. Rotasi akun lama yang masih memakai password pabrik melalui terminal. Ulangi dengan password unik untuk setiap akun terkait. **Jangan mengubah salinan backup**.

```bash
ACCOUNT=admin@arena.test  # ganti ke akun yang hendak dirotasi; ulangi untuk operator bila masih default
read -r -s -p 'Password baru akun ini (min. 12 karakter): ' NEW_PASS; printf '\n'
printf '%s' "$NEW_PASS" | sudo -u fiberops env ARENA_DB_PATH="$DB" \
  node scripts/set-password.mjs "$ACCOUNT"
unset NEW_PASS
sudo -u fiberops node scripts/preflight.mjs "$DB"
```

Jika menghapus akun demo, lakukan setelah admin pribadi berhasil digunakan dan jangan menghapus satu-satunya admin. Nama/email yang diketahui umum bukan lagi password; jangan berbagi satu akun operator untuk semua staf.

### B3. Konfigurasi, restart, verifikasi

Tambahkan pengaturan produksi A4 ke unit/environment yang benar. Jangan meninggalkan dua definisi `Environment` yang bertentangan; cocokkan upstream reverse proxy dengan port/bind aktual. **Jangan mengubah ownership seluruh kode ke user service**; cukup direktori/file data. Pada instalasi lama yang perlu perbaikan izin, saat service berhenti:

```bash
sudo chown -R fiberops:fiberops /opt/fiberops/data
sudo chmod 700 /opt/fiberops/data
sudo find /opt/fiberops/data -maxdepth 1 -type f -name 'fiberops.db*' -exec chmod 600 {} +
sudo systemctl daemon-reload
sudo systemctl start fiberops
sudo systemctl status fiberops --no-pager
curl --retry 10 --retry-delay 1 --retry-connrefused --fail http://127.0.0.1:8080/healthz
sudo journalctl -u fiberops -n 80 --no-pager
sudo -u fiberops node /opt/fiberops/scripts/preflight.mjs "$DB"
```

Jika salah path, izin, build atau migrasi: **jangan menghapus DB/volume supaya service hidup**. Hentikan, periksa log, gunakan salinan DB untuk diagnosis atau rollback. Hard-refresh browser dan jalankan checklist F sebelum maintenance ditutup.

## C. Docker — volume dan UID harus diperhatikan

Docker di LXC mungkin memerlukan fitur nesting; pertimbangkan VM jika kebijakan Proxmox Anda tidak mendukung Docker di unprivileged LXC. Jangan membuka akses host lebih luas tanpa meninjau risikonya. Perintah Docker memerlukan hak administrator Docker.

Image runtime baru memakai `NODE_ENV=production` dan **user `node` (UID/GID 1000 di image resmi)**. Image lama mungkin menulis DB sebagai root. Pertahankan mount data dan perbaiki ownership **setelah container lama berhenti**. Jangan menjalankan image lama/baru bersamaan pada DB yang sama.

### C1. Instalasi baru saja

```bash
cd /opt/fiberops
docker build -t fiber-core:release .
VOL=fiber-core-data  # hanya untuk volume instalasi BARU; update lihat C2
docker volume create "$VOL"
docker run --rm --user 0 -v "$VOL:/app/data" --entrypoint sh fiber-core:release \
  -c 'chown -R node:node /app/data && chmod 700 /app/data'
read -r -s -p 'Password admin baru: ' ADMIN_PASS; printf '\n'
printf '%s' "$ADMIN_PASS" | docker run --rm -i -v "$VOL:/app/data" \
  --entrypoint node fiber-core:release scripts/create-admin.mjs admin@domain-anda.id
unset ADMIN_PASS

docker run -d --name fiber-core --restart unless-stopped \
  -p 127.0.0.1:8080:8080 -v "$VOL:/app/data" \
  -e ARENA_PUBLIC_ORIGIN=https://fiber.domain-anda.id -e ARENA_SECURE_COOKIES=1 \
  fiber-core:release
docker logs --tail 60 fiber-core
docker exec fiber-core node scripts/preflight.mjs /app/data/fiberops.db
```

Proxy HTTPS berada di host/container yang bisa mencapai publikasi lokal tersebut. Jika proxy berada di container terpisah, gunakan jaringan privat Docker yang sesuai, bukan `localhost` pada browser. Untuk LAN/VPN HTTP saja, sesuaikan bind/origin/cookie dan firewall seperti A4.

### C2. Update Docker yang sudah ada

1. Catat image ID lama, seluruh konfigurasi `docker inspect`, mapping port, mount/volume dan UID lama. Pastikan Anda dapat menjalankan image lama lagi; jangan prune image/container/volume saat maintenance.
2. Stop container lama. Backup **seluruh `/app/data`** dari container yang sudah berhenti, termasuk WAL/SHM jika ada, ke direktori privat di luar volume. `docker cp` ini aman hanya karena penulis telah dihentikan.

```bash
set -euo pipefail
OLD_IMAGE=$(docker inspect --format '{{.Image}}' fiber-core)
docker inspect --format '{{range .Mounts}}{{println .Type .Name .Source "->" .Destination}}{{end}}' fiber-core
# Ambil mount sebenarnya; jangan menggantinya dengan nama volume tebakan.
DATA_MOUNT=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' fiber-core)
if [ -z "$DATA_MOUNT" ]; then echo 'TUNDA: mount /app/data tidak ditemukan'; exit 1; fi
STAMP=$(date +%Y%m%d-%H%M%S)
SAFE=/backup/fiberops/docker-$STAMP
sudo install -d -m 700 "$SAFE/data"
docker inspect fiber-core | sudo tee "$SAFE/container.json" >/dev/null
printf '%s\n' "$OLD_IMAGE" | sudo tee "$SAFE/image.txt" >/dev/null
docker update --restart=no fiber-core  # kebijakan lama sudah tersimpan di container.json
docker stop fiber-core
docker cp -a fiber-core:/app/data/. "$SAFE/data/"
# Salin juga SAFE ke storage lain. container.json bisa memuat environment privat.
```

Jalankan operasi filesystem pada direktori backup dengan hak pemiliknya (misalnya root). Jangan membuat backup dapat dibaca publik hanya untuk mengatasi permission.

3. Ambil kode yang sudah di-merge, build dengan tag unik, lalu buat juga snapshot DB tunggal konsisten memakai script baru:

```bash
cd /opt/fiberops
git pull --ff-only origin main
NEW_IMAGE=fiber-core:$(git rev-parse --short HEAD)
docker build -t "$NEW_IMAGE" .
docker run --rm --user 0 -v "$DATA_MOUNT:/app/data" -v "$SAFE:/backup" \
  --entrypoint node "$NEW_IMAGE" scripts/backup.mjs /app/data/fiberops.db /backup/before-update.db
# Semua penulis tetap berhenti; sesuaikan izin volume lama untuk user image baru.
docker run --rm --user 0 -v "$DATA_MOUNT:/app/data" --entrypoint sh "$NEW_IMAGE" \
  -c 'chown -R node:node /app/data && chmod 700 /app/data && chmod 600 /app/data/fiberops.db*'
```

4. Buat admin pribadi/rotasi password lama **melalui stdin** bila diperlukan. Contoh rotasi (ulangi akun yang masih default):

```bash
read -r -s -p 'Password baru akun: ' NEW_PASS; printf '\n'
printf '%s' "$NEW_PASS" | docker run --rm -i -v "$DATA_MOUNT:/app/data" \
  --entrypoint node "$NEW_IMAGE" scripts/set-password.mjs admin@arena.test
unset NEW_PASS
docker run --rm -v "$DATA_MOUNT:/app/data" --entrypoint node "$NEW_IMAGE" \
  scripts/preflight.mjs /app/data/fiberops.db
```

Bila perlu akun baru, ganti script dengan `scripts/create-admin.mjs email-pribadi`. Jangan lanjut sampai penghalang preflight terselesaikan.

5. Simpan container lama untuk rollback; ganti dengan yang baru **dengan volume yang sama** dan konfigurasi deployment yang telah disesuaikan:

```bash
docker rename fiber-core "fiber-core-before-$STAMP"
docker run -d --name fiber-core --restart unless-stopped \
  -p 127.0.0.1:8080:8080 -v "$DATA_MOUNT:/app/data" \
  -e ARENA_PUBLIC_ORIGIN=https://fiber.domain-anda.id -e ARENA_SECURE_COOKIES=1 \
  "$NEW_IMAGE"
docker logs --tail 80 fiber-core
curl --retry 10 --retry-delay 1 --retry-connrefused --fail http://127.0.0.1:8080/healthz
docker exec fiber-core node scripts/preflight.mjs /app/data/fiberops.db
```

Jangan menjalankan ulang container lama selama yang baru hidup. Kebijakan restart container lama sudah dinonaktifkan di langkah 2 supaya reboot tidak menghidupkan dua penulis; pulihkan kebijakan yang tercatat hanya jika melakukan rollback. Jangan hapus backup/container/image lama sampai verifikasi dan masa observasi selesai.

## D. Backup berkala & restore/rollback

### Backup konsisten pada versi baru

```bash
# Native: siapkan direktori tujuan privat yang bisa ditulis pemilik backup.
sudo -u fiberops node /opt/fiberops/scripts/backup.mjs \
  /opt/fiberops/data/fiberops.db /backup/fiberops/fiberops-$(date +%Y%m%d-%H%M%S).db
```

Script menggunakan SQLite `VACUUM INTO` dengan sumber read-only, memasukkan transaksi WAL yang sudah committed, memeriksa `quick_check`, dan **menolak menimpa backup yang sudah ada**. Bisa digunakan saat aplikasi aktif; sediakan ruang disk cukup. `quick_check` bukan bukti semua data lapangan benar. Uji restore pada salinan secara berkala dan simpan salinan terenkripsi/off-host dengan akses terbatas.

Contoh crontab **user `fiberops`** setelah direktori backup disiapkan:

```cron
0 2 * * * /usr/bin/node /opt/fiberops/scripts/backup.mjs /opt/fiberops/data/fiberops.db /backup/fiberops/fiberops-$(date +\%Y\%m\%d-\%H\%M\%S).db
```

Pantau exit/log, kapasitas disk dan retensi; jangan menghapus satu-satunya backup sehat. Pada Docker, mount direktori backup privat ke container backup sekali-jalan dan jalankan script seperti C2; backup jangan hanya diletakkan dalam volume yang hendak diganti.

### Restore database native

**Hentikan semua penulis terlebih dahulu.** Periksa backup dan pasangkan dengan versi kode sebelum update. Restore snapshot lama akan membuang perubahan yang dibuat setelah snapshot itu; simpan kondisi gagal dan lakukan rekonsiliasi bila maintenance sempat dibuka.

```bash
# Tentukan BKP yang benar; jangan menyalin placeholder atau memilih berdasar tebakan.
DB=/opt/fiberops/data/fiberops.db
sudo -u fiberops sqlite3 -readonly "$BKP" 'PRAGMA quick_check; PRAGMA foreign_key_check;'
# Lanjut hanya jika hasil sesuai harapan: ok dan tidak ada FK error.
sudo systemctl stop fiberops
FAILED=/backup/fiberops/failed-$(date +%Y%m%d-%H%M%S)
sudo install -d -o fiberops -g fiberops -m 700 "$FAILED"
# Karantina set lama, jangan biarkan WAL/SHM lama menimpa database hasil restore.
for suffix in '' '-wal' '-shm'; do
  if sudo test -e "$DB$suffix"; then sudo mv "$DB$suffix" "$FAILED/"; fi
done
sudo install -o fiberops -g fiberops -m 600 "$BKP" "$DB"
```

Jika kode baru juga perlu di-rollback, siapkan **worktree release terpisah pada commit yang dicatat B1**, lalu `npm ci && npm run build` di sana. Contoh (jalankan Git dengan akun pemilik repository):

```bash
# BEFORE diambil dari file .commit.txt backup yang sesuai, bukan SHA tebakan.
ROLLBACK=/opt/fiberops-rollback-$(date +%Y%m%d-%H%M%S)
sudo install -d -o "$USER" -g "$(id -gn)" -m 755 "$ROLLBACK"
cd /opt/fiberops
git worktree add --detach "$ROLLBACK" "$BEFORE"
(cd "$ROLLBACK" && npm ci && npm run build)
```

Arahkan `WorkingDirectory` dan `ExecStart` systemd ke worktree tersebut, **tetap gunakan `ARENA_DB_PATH=/opt/fiberops/data/fiberops.db`** dan `ReadWritePaths` data asli. `systemctl daemon-reload`, start, periksa log/health/data dan jalankan checklist lagi. Jangan menyalakan versi lama terhadap DB yang sudah dimigrasikan tanpa memeriksa kompatibilitas; pasangan **kode + DB backup sebelum update** adalah jalur rollback. Versi lama bisa memiliki kelemahan yang sudah diperbaiki: pertahankan pembatasan jaringan selama rollback.

### Restore Docker

Stop container baru dan pastikan container lama juga berhenti. Karantina seluruh isi volume gagal; restore **seluruh set `data/` offline yang dicatat C2 beserta ownership lamanya**, atau pasang snapshot DB tunggal sehat setelah menyingkirkan WAL/SHM lama. Lakukan menggunakan container maintenance dengan mount data yang sama. Jangan mencampur `.db` backup dengan `-wal`/`-shm` dari versi gagal. Jalankan kembali **image/container lama yang dicatat** dengan konfigurasi/mount yang sama; jangan menjalankan kedua container. Pulihkan kebijakan restart lama setelah hanya satu container aktif. Verifikasi isi data dan akses sebelum membuka maintenance.

## E. Reverse proxy HTTPS, firewall dan login limiter

Untuk internet gunakan HTTPS **dan** pembatasan akses (VPN/IP allowlist disarankan), bukan Vite dev server. Jangan membuka port backend langsung ke internet. Contoh Nginx berikut diasumsikan sudah memiliki sertifikat valid; ganti domain/path sertifikat sesuai instalasi Anda:

```nginx
# http {}: log tidak menyimpan query string (penting jika ada klien lama).
log_format fiber_safe '$remote_addr [$time_local] "$request_method $uri $server_protocol" $status $body_bytes_sent';
limit_req_zone $binary_remote_addr zone=fiber_login:10m rate=6r/m;

server {
    listen 80;
    server_name fiber.domain-anda.id;
    return 301 https://fiber.domain-anda.id$request_uri;
}
server {
    listen 443 ssl;
    server_name fiber.domain-anda.id;
    ssl_certificate /etc/letsencrypt/live/fiber.domain-anda.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fiber.domain-anda.id/privkey.pem;
    access_log /var/log/nginx/fiber-access.log fiber_safe;
    client_max_body_size 1m;
    add_header Content-Security-Policy "frame-ancestors 'self'" always;

    location = /api/login {
        limit_req zone=fiber_login burst=5 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Tinjau konfigurasi dengan `nginx -t` sebelum reload. Atur TLS/certbot, pembaruan sertifikat dan firewall sesuai domain/topologi Anda; jangan mematikan firewall atau mengubah jaringan hanya agar halaman terbuka. Header frame-ancestors ini **untuk deployment Anda**, bukan konfigurasi preview Arena yang memang disematkan dalam iframe. HSTS dapat ditambahkan setelah HTTPS dipastikan benar; jangan mengaktifkan kebijakan jangka panjang pada domain yang belum siap.

Proxy harus meneruskan `Authorization` atau header aplikasi `X-Fiberops-Token`
(dan cookie bila dipakai). Jangan memindahkan token ke URL atau mencatat nilai
header kredensial. Header khusus menjadi cadangan untuk preview/proxy yang
menyaring header standar; tetap memerlukan token sesi sah dan pemeriksaan origin.
Batasi akses/retensi log lama karena versi lama mungkin pernah memakai token URL.

Backend membatasi **30 percobaan login/10 menit/alamat klien**, termasuk login berhasil. Secara default alamat diambil dari socket; `X-Forwarded-For` tidak dipercaya. Tanpa konfigurasi proxy, operator di balik proxy/NAT berbagi kuota. `ARENA_TRUSTED_PROXY_IPS` hanya boleh diisi **IP proxy yang benar-benar Anda kendalikan**, dengan port backend tidak dapat diakses klien langsung dan proxy selalu **menimpa `X-Real-IP`**. Tidak menerima wildcard/CIDR. Native loopback memakai contoh A4. Docker/proxy terpisah harus memakai alamat peer proxy yang benar dari jaringan Docker, bukan menebak atau mempercayai semua IP. Bila belum dikonfigurasi, kuota bersama tetap berlaku; IP publik NAT juga tetap berbagi kuota. Rate limit bukan perlindungan DDoS penuh dan reset ketika proses restart.

## F. Checklist go/no-go setelah update

- [ ] Backup konsisten + revision/image lama tercatat, tersimpan off-host dan restore pernah dicoba pada salinan.
- [ ] DB/path/volume yang digunakan benar, bukan database baru; hanya satu penulis aktif.
- [ ] `NODE_ENV=production`, izin user service, disk/RAM, waktu host dan firewall diverifikasi di Proxmox.
- [ ] Preflight tidak memiliki penghalang; seluruh peringatan dibaca. Tidak ada FK rusak atau posisi card ganda.
- [ ] Admin pribadi berhasil login; akun default sudah dirotasi/dihapus. User/operator/admin mempunyai akses yang sesuai.
- [ ] Browser hard-refresh sebelum login; request baru tidak memakai parameter URL `token`.
- [ ] Dashboard sesuai inventaris sebelum update: OLT/model, tipe/jumlah card, shelf/slot, kapasitas, port tercatat. Tidak ada GTGO/GTGH/card/OLT tambahan yang tidak nyata.
- [ ] Sampel satu jalur C300 dan C320 ditelusuri dari interface → core feeder → splitter/cascade → ODC anak/ODP; receiver/labelnya sesuai fisik. Data belum diketahui tetap **Belum dipetakan**.
- [ ] Port **aktif** adalah status manual; **terpakai** adalah mapping eksplisit yang valid, sekali per port. Keduanya dapat tumpang tindih, bukan penjumlahan atau deteksi OLT langsung.
- [ ] Pencarian/filter, edit yang disengaja, pembatalan form, desktop/mobile dan tiga laporan lama tetap bekerja.
- [ ] CSV terunduh sesuai filter; **Lihat PDF** benar-benar menampilkan halaman/canvas, bukan hanya modal; file PDF dapat diunduh.
- [ ] HTTPS/cookie Secure dan origin proxy benar; port backend tidak terbuka untuk publik; health/log tidak mengandung error baru.

**Tunda pembukaan maintenance** jika inventaris berubah tanpa penjelasan, login tidak aman, backup belum teruji, atau jalur/ID tidak sesuai. Lulus tes aplikasi tidak menggantikan pemeriksaan server maupun verifikasi sambungan fisik di lapangan.
