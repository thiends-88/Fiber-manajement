# Update FiberOps existing di Proxmox — akun dan input tetap

Jalur ini khusus **aplikasi yang sudah berjalan**, Node langsung + systemd. Tujuannya memperbarui kode dari `origin/main`, **bukan** instal ulang atau hardening akun.

- Tidak mengganti akun, password, role, unit systemd, `NODE_ENV`, port, atau path DB.
- Tidak menghapus/mereset DB, menjalankan seed demo, menebak receiver, atau mengisi inventaris fisik.
- Mengambil backup konsisten, mencoba startup/migrasi pada **salinan privat**, kemudian membandingkan nilai/ID lama pada DB existing.
- Schema tambahan dan pencabutan sesi oleh migrasi keamanan tetap dapat terjadi. Login ulang bukan reset akun. Login valid dapat memperkuat hash lama tanpa mengganti password yang diketik.

**Status publikasi:** panduan dan `scripts/update-existing.sh` merupakan tambahan setelah PR #10 (`22f1dfe`). Keduanya harus sudah masuk `main` lewat PR pendukung yang ditinjau sebelum perintah ini dapat digunakan. `main` yang hanya berisi PR #10 belum punya helper ini; launcher akan berhenti tanpa stop service atau perubahan kode/DB. Jangan menggantinya dengan `git pull` lalu restart.

Bukti uji, konfigurasi sampel, batas jaminan dan skenario gagal ada di **[UJI-UPDATE-EXISTING-2026-11-06.md](UJI-UPDATE-EXISTING-2026-11-06.md)**. Sampel bukan jaminan semua modifikasi database lokal kompatibel.

## 1. Sebelum menyalin perintah

1. Jalankan di **konsol VM/LXC tempat aplikasi berada**, sebagai root; bukan di host Proxmox lain. Contoh existing: `/opt/fiberops`, `fiberops.service`, user `fiberops`, DB `/opt/fiberops/data/fiberops.db`, port 8080. Updater membaca ulang PID, executable Node, environment dan inode DB yang benar-benar dibuka service; tidak memakai PID lama.
2. Siapkan maintenance window. Minta semua operator berhenti input **dan login** sampai verifikasi selesai. Jangan jalankan updater/hardening lain atau ubah unit/environment bersamaan.
3. Buat **backup Proxmox/VM/LXC yang dapat dipulihkan** sebelum update, serta salinan konfigurasi/env/secrets secara lokal dan privat. Idealnya coba pada clone terisolasi/dengan IP berbeda terlebih dahulu. Jangan unggah DB atau password ke chat/Git.
4. Pastikan Node service **22.13+**, checkout server di `main` dan bersih, target fast-forward, internet untuk Git/npm, dan ruang disk/RAM cukup untuk build + backup + salinan DB. Jangan menjalankan reset/stash otomatis atau menghapus DB bila pengecekan gagal.
5. Akun berpassword pabrik tetap berisiko walau aplikasi internal. Pada mode existing **nonproduksi**, peringatan boleh diakui tanpa mengubah akun. **Mode produksi dan preflight default tetap ketat**: password pabrik menghalangi, tidak dibypass dengan menurunkan mode. Tidak ada perubahan mode otomatis.

PM2, npm-wrapper, Docker, `DynamicUser`, loader/env-file melalui argumen Node, DB yang tidak cocok dengan PID, dan Git yang divergen perlu pemeriksaan lain; prosedur ini menolak, bukan menebak.

## 2. Satu perintah untuk instalasi existing standar

Salin **seluruh blok**. `git fetch` hanya mengambil objek/ref; working tree dan DB belum berubah. Launcher mengambil dua helper dari commit `origin/main` yang sama ke direktori sementara, **bukan** mengubah checkout sebelum backup. Jika target bergerak selama persiapan, updater menunda.

<!-- existing-update-launcher:start -->
```bash
(
  set -Eeuo pipefail
  umask 077
  if (( EUID != 0 )); then
    echo 'TUNDA: jalankan sebagai root di konsol VM/LXC aplikasi.' >&2
    exit 1
  fi
  APP=${FIBEROPS_APP_DIR:-/opt/fiberops}
  cd "$APP"
  test -d .git || { echo 'TUNDA: checkout .git tidak ditemukan.' >&2; exit 1; }
  OWNER=$(getent passwd "$(stat -c %u .git)" | cut -d: -f1)
  test -n "$OWNER" || { echo 'TUNDA: pemilik checkout tidak ditemukan.' >&2; exit 1; }
  as_owner() { runuser -u "$OWNER" -- git "$@"; }
  as_owner fetch origin
  TARGET=$(as_owner rev-parse --verify 'origin/main^{commit}')
  LAUNCH=$(mktemp -d /tmp/fiberops-existing-launch.XXXXXXXX)
  trap 'rm -rf -- "$LAUNCH"' EXIT
  for FILE in update-existing.sh check-existing-update.mjs; do
    if ! as_owner show "$TARGET:scripts/$FILE" >"$LAUNCH/$FILE"; then
      echo 'TUNDA: main belum memuat helper existing; merge PR pendukung dahulu. Service/DB belum diubah.' >&2
      exit 1
    fi
  done
  bash -n "$LAUNCH/update-existing.sh"
  FIBEROPS_EXPECTED_TARGET="$TARGET" bash "$LAUNCH/update-existing.sh"
)
```
<!-- existing-update-launcher:end -->

Bila path/unit berbeda, **jangan menebak**. Setelah memastikan instalasinya, variabel yang didukung adalah `FIBEROPS_APP_DIR`, `FIBEROPS_SERVICE`, dan `FIBEROPS_BACKUP_DIR` (default `/var/backups/fiberops/existing`, harus di luar checkout/DB). Direktori backup yang sudah ada harus root:root-0700; jika tidak, pilih subdirektori privat baru. Updater tidak diam-diam mengubah izin direktori existing. Bootstrap dan helper menggunakan variabel yang sama; environment aplikasi tetap diambil dari service, bukan dari shell operator.

Jika ada baris `CEK`, baca dahulu. Ketik **`LANJUT` hanya bila memahami peringatannya**. Jawaban lain atau tidak adanya terminal interaktif akan menunda. Jangan meneruskan bila fisik/kapasitas/data belum cocok. ODP tanpa splitter ditolak pada jalur pelestarian karena startup aplikasi existing bisa menambahkan 1:8; tidak diisi otomatis oleh updater ini.

## 3. Kapan dianggap selesai?

Tunggu **`UPDATE EXISTING SELESAI`**, bukan hanya build selesai. Updater memeriksa:

1. Backup SQLite `VACUUM INTO` konsisten (termasuk transaksi WAL committed), kode/dist lama, unit dan commit sebelum/target. Folder backup root-0700 dan DB backup root-0600; DB existing tidak di-chown/chmod.
2. Semua kolom lama, nilai/baris/ID eksplisit, hash akun, field/tabel tambahan dan penghitung ID lama identik sebelum login; tabel/kolom baru diperbolehkan. `sessions` dan `security_migrations` dikecualikan secara eksplisit, bukan seluruh tabel akun.
3. Probe startup pada salinan dengan user/group/mode/environment service yang sama; hanya path DB, bind loopback dan port probe yang diganti. Tidak memakai DB asli untuk percobaan migrasi.
4. `/healthz`, PID/runtime, path DB, UID/GID, mode dan variabel `ARENA_*`/Node tetap sesuai setelah service berjalan; manifest dan preflight diulang pada DB existing.

Setelah itu, **periksa manual sebelum operator kembali input**:

- `systemctl status fiberops.service --no-pager` dan `curl --fail http://127.0.0.1:8080/healthz` sesuai port aktual.
- Login memakai akun/password yang sama; cocokkan role, jumlah **terakhir sebelum update** (bukan selalu angka contoh 1/6/80/62/2), lalu buka beberapa OLT/card/port, ODC/ODP, core, notes, feeder dan receiver yang sudah diinput.
- Di daftar ODC **dan** ODP, klik nama/baris pertama dan salah satu perangkat di akhir daftar: harus langsung membuka area input perangkat yang benar. Coba tombol **Core**, **Interface feeder / Asal interface**, **Splitter**, dan **Kembali ke daftar** pada desktop/HP. Klik ulang tidak menghapus pilihan atau menyimpan data. Bila UI masih lama, hard-refresh (Ctrl+F5). Navigasi baru ini ikut PR #11, sehingga harus sudah di-merge bersama helper sebelum update.
- Cek GPS/layer jalur yang memang Anda simpan. Tidak ada permintaan mengunggah ulang, mengarang GPS, atau mengimpor data contoh.
- Simpan path backup/commit yang tercetak. Migrasi sesi mungkin meminta login ulang; hash legacy bisa berubah sesudah login valid, tetapi password pengguna tetap sama.

Jangan menganggap peringatan keamanan sudah selesai hanya karena pelestarian data lulus. Hardening akun/jaringan adalah pekerjaan terpisah yang perlu keputusan operator.

## 4. Bila `TUNDA` / gagal

**Sebelum maintenance:** service belum diminta berhenti; kode, akun dan DB belum diperbarui. `fetch` boleh sudah memperbarui ref Git. Jangan memaksa lewat `reset --hard`, seed, ganti volume, atau mengganti password agar uji lewat.

**Sesudah maintenance dimulai:** updater mencoba menghentikan service dan **tidak melakukan rollback otomatis**. Konfirmasi `systemctl status`; bila stop gagal, anggap masih ada proses aktif dan jangan menyalin DB. Backup bisa belum lengkap bila kegagalan terjadi pada snapshot. Baca pesan/log privat dan pastikan `database.db`, manifest serta arsip kode/dist benar-benar tersedia sebelum memilih pemulihan.

Untuk pemulihan, hentikan semua penulis DB, simpan keadaan gagal secara privat, lalu uji **pasangan kode lama + DB backup lama** pada salinan/clone terlebih dahulu. Pulihkan melalui backup Proxmox yang sudah diuji atau konsep [restore/rollback](DEPLOY-PROXMOX.md#d-backup-berkala--restorerollback) setelah memeriksa path/unit/ownership dan pasangan backup. Backup updater ini root-privat: jangan menyalin contoh pembacaan backup sebagai `fiberops` secara mentah atau membuka izin backup; gunakan root atau salinan staging privat dengan ownership yang tepat. Jangan menimpa DB aktif, mengembalikan kode saja setelah migrasi, atau mencampur WAL/SHM lama dengan DB lain. Jangan lanjut input sampai pemulihan diverifikasi.

Backup sebelum update tidak memuat input setelah timestamp backup. Restore backup lama dapat membuang input yang dibuat sesudahnya; itulah sebabnya operator harus tetap berhenti input selama maintenance dan verifikasi. Uji otomatis menguji rollback **pada salinan**, bukan menjanjikan rollback Proxmox otomatis.

## Jalur lain: instalasi baru / produksi ketat

[DEPLOY-PROXMOX.md](DEPLOY-PROXMOX.md) dan [`scripts/update-native.sh`](scripts/update-native.sh) tetap tersedia untuk produksi ketat dengan akun nonpabrik. **Jangan dicampur** ke jalur existing di atas hanya untuk memperbarui kode. Kedua updater berbagi lock agar tidak berjalan bersamaan. Prosedur di sini tidak menjalankan CLI pembuatan akun/rotasi password dan tidak mengubah pengaman login aplikasi.
