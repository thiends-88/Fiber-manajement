# Hasil uji update existing — 6 November 2026

## Keputusan

**LULUS pada data sampel terisolasi:** pembaruan kode aplikasi dapat mempertahankan akun/password, role, ID dan input lama tanpa reset data atau konversi mode service. Input tambahan sesudah update pertama juga bertahan pada update berikutnya.

**TUNDA menjalankan prosedur baru di Proxmox sampai helper pendukung sudah masuk `main` dan backup lokal/VM siap.** Ini bukan pernyataan bahwa server Proxmox sudah diperbarui atau database privatnya telah diuji. Tidak ada akses, deployment, rotasi akun, perubahan konfigurasi, atau pengambilan DB/password Proxmox dalam pengujian ini. Pengujian dilakukan sebelum publikasi PR pendukung; periksa status PR sampai **Merged** sebelum menjalankan panduan. Agen tidak melakukan merge atau deployment otomatis.

Panduan operasional satu jalur: **[PERINTAH-UPDATE-PROXMOX.md](PERINTAH-UPDATE-PROXMOX.md)**. Pisahkan pembaruan kode dari keputusan hardening akun/jaringan.

## 1. Asal kode dan lingkungan uji

- Sumber sebelum update: `8e8aada04b1c44a57dcc5b325e1076db0a331562` (main sebelum PR #10).
- Baseline merged PR #10: `22f1dfef0e5e67e15ad6f8c78fe80dd8fff805c0`.
- Kandidat uji: kode aplikasi workspace di atas baseline merged tersebut, ditambah helper, preflight pelestarian dan pengujian baru. **`server.mjs`, `server/`, `src/`, lockfile dan konfigurasi build tidak diubah dari baseline merged**. Updater produksi lama `scripts/update-native.sh` juga tidak diubah. Yang berubah pada aplikasi operasional hanyalah CLI preflight opsional; bukan perilaku login/API/server atau antarmuka bisnis.
- Fixture memakai repositori dan bare remote Git **lokal sementara**, bukan push ke GitHub. Commit fixture berbeda SHA dari commit sumber karena tambahan dukungan updater; ini bukan klaim melakukan fast-forward persis ke SHA `22f1dfe` tanpa tambahan file.
- Linux, Node **22.22.3**, npm **10.9.8**, SQLite bawaan Node. Proses service/probe berjalan dengan UID/GID non-root yang nyata dan berbeda dari runner root. Path DB fixture berada di luar checkout dan mengandung spasi.
- Git fetch/fast-forward, SQLite, API HTTP, UID/GID dan manifest nyata. **`systemctl` dimock**; npm ci/build nyata pada skenario legacy-upgrade, termasuk update ulangnya. npm pada skenario lain dimock agar injeksi kegagalan terisolasi dan waktu uji terkendali.
- Chromium **153.0.8010.0** untuk build production. Browser memakai software rendering dan `--no-sandbox` untuk lingkungan uji; web security/site isolation tidak dimatikan. Paket/binary browser dipasang terpisah di cache pengujian, bukan dependency aplikasi.

Verifikasi kode aplikasi/strict updater yang tidak berubah:

```bash
git diff --exit-code 22f1dfef0e5e67e15ad6f8c78fe80dd8fff805c0 -- \
  server.mjs server src package-lock.json index.html vite.config.js scripts/update-native.sh
```

## 2. Data sampel — bukan inventaris lapangan

| Sampel | OLT | Card | Port | ODC | ODP |
|---|---:|---:|---:|---:|---:|
| ZTE C300 | 1 | 6 | 80 | 62 | 2 |
| ZTE C320 | 1 | 2 | 16 | 5 | 2 |

Angka C300 meniru skala yang pernah dilaporkan, **bukan** menyalin data pengguna atau mengasumsikan jumlah terbaru masih sama. Tipe/kapasitas card fixture diisi eksplisit untuk uji data, bukan verifikasi spesifikasi atau koneksi hardware OLT.

Fixture berisi:

- Tiga akun sintetis: admin, operator dan pembaca (`user`), termasuk dua akun berpassword pabrik pada mode existing nonproduksi dan campuran hash SHA-256 lama/scrypt. Ada skenario produksi terpisah dengan seluruh password privat.
- ID tidak berurutan, dua ODC bernama sama, nama/catatan Unicode, alamat non-GPS, serial/status port, asset tag custom, tabel tambahan, BLOB, serta integer `1152921504606846976` yang melampaui presisi aman JavaScript Number.
- Cascade splitter, target receiver ODC eksplisit dan receiver yang sengaja belum dipilih, feeder, mapping interface/core, core link dan label pelanggan sintetis. Kolom legacy `input_splitter_id`/`input_power` dibuat khusus fixture untuk memastikan kolom tambahan tidak dibuang; bukan klaim kolom itu bagian schema standar versi lama.
- Penghitung ODC pernah mencapai ID `99991` lalu baris sementara dihapus: nomor berikutnya tidak boleh di-reset ke MAX baris yang masih tersisa.
- GPS manual dan layer jalur tersimpan pada C320, termasuk ID batch/segmen dan urutan koordinat yang sama setelah restart/update.
- Transaksi committed di WAL saat server masih membuka DB. Sampel legacy memakai bind `0.0.0.0`, `NODE_ENV` tidak diset, serta DB-0644/direktori-0755 untuk memastikan peringatan izin tidak berubah menjadi chmod/konversi mode otomatis.

IP TEST-NET, koordinat dan semua nama berlabel uji adalah **sintetis**. Tidak ada file jalur privat pengguna yang diimpor, tidak ada kontak ke perangkat OLT, dan tidak ada data sampel dimasukkan ke DB aplikasi existing.

## 3. Hasil akhir yang dijalankan

| Pemeriksaan | Hasil | Catatan |
|---|---|---|
| `npm run test:update-existing` | **LULUS — 13 unit + 35 pemeriksaan integrasi / 27 skenario** | Putaran penuh terakhir 159,124 detik; Git/SQLite/API/UID nyata, systemctl mock; npm nyata pada legacy |
| `npm test` | **LULUS** | Seluruh rangkaian regresi aplikasi + 13 unit manifest; 82,661 detik pada putaran terakhir |
| `npm run test:update-native` | **LULUS — 15 skenario** | Jalur produksi ketat tetap berfungsi dan tidak dilonggarkan |
| Browser production | **LULUS — 20 pemeriksaan** | Login, role, form pending/retry, CSV/PDF, mobile, sesi dan XSS |
| Browser peta | **LULUS — 29 pemeriksaan** | GPS, satelit fixture/fallback, fullscreen, filter dan KMZ tanpa garis skematis |
| Browser jalur | **LULUS — 22 pemeriksaan** | Impor/persistensi/Canvas/worker/KMZ/mobile tanpa mengubah inventaris/akun |
| Render smoke | **LULUS — 12 pemeriksaan** | 11 rute + pengalihan `/users` untuk operator, pada DB demo sementara |
| `npm run build` | **LULUS** | 3,00 detik; bundle utama 912,33 kB / gzip 281,21 kB, sama dengan baseline |
| Bash/Node syntax | **LULUS** | Updater, checker, fixture, harness dan blok launcher panduan |

Unit manifest sudah dimasukkan ke `npm test`; jangan menjumlahkan ulang unit yang sama sebagai cakupan independen. `npm ci` baseline mengaudit 163 paket dengan 0 vulnerability yang dilaporkan pada saat pengujian; itu bukan jaminan keamanan menyeluruh. Peringatan SQLite experimental dan ukuran chunk Vite >500 kB tetap ada, bukan kegagalan build. Patch ini tidak menambah dependency atau beban JavaScript frontend.

Ringkasan keluaran putaran penuh terakhir:

```text
MANIFEST PELESTARIAN: 13 pemeriksaan lulus.
UPGRADE EXISTING: 35 pemeriksaan / 27 skenario lulus.
Git/SQLite/API/UID nyata pada fixture lokal; systemctl dimock.
npm nyata: legacy-upgrade.
BROWSER: 20 pemeriksaan lulus.
BROWSER PETA: 29 pemeriksaan lulus.
BROWSER JALUR: 22 pemeriksaan lulus.
UPDATER: 15 skenario lulus.
SEMUA HALAMAN TAMPIL NORMAL
```

### Bukti pelestarian yang diuji

- Seluruh nilai pada kolom lama, jumlah baris, ID eksplisit, nama/email/role/hash akun, custom field/table/BLOB/BigInt dan penghitung AUTOINCREMENT dibandingkan dengan manifest sebelum login. Bukan hanya membandingkan jumlah OLT/ODC/ODP.
- Akun/password lama tetap dapat login; operator/pembaca tetap ditolak pada API admin/tulis yang tidak diizinkan. Nama sama tidak digabung, receiver kosong tidak ditebak, nilai/ID GPS/layer tersimpan tetap ada.
- Backup aktif memasukkan transaksi WAL committed; backup updater root-0700/DB root-0600. UID/GID dan mode DB/direktori existing tidak diubah, termasuk contoh izin longgar yang hanya diberi peringatan.
- Sesudah update pertama, API menambahkan ODC/ODP baru. Update berikutnya benar-benar mengganti file updater yang sedang dipakai dengan commit fixture baru; input baru, ID dan catatannya tetap ada. Sumber shell/checker dibekukan sebelum fast-forward, bukan sekadar menjalankan updater dari checkout lain.
- **Blok launcher dari panduan diekstrak dan dijalankan apa adanya** pada fixture, dengan override path/unit/backup khusus uji. Pengambilan helper tidak mengubah working tree sebelum backup, dan target commit dipin.
- Pemulihan pasangan arsip kode lama + DB backup diuji pada direktori salinan: manifest lama cocok, server lama sehat dan password owner lama dapat login. Ini uji API/SQLite pada salinan; bukan restore VM, systemd nyata, jaringan, atau uji penuh bundle frontend lama.

### Skenario sukses dan penolakan

Lima jalur sukses: `legacy-upgrade`, `modern-c320`, `production-private`, `guide-bootstrap`, `security-session-migration`. Ditambah pemeriksaan login/role pada masing-masing, WAL aktif, update ulang/self-replacement dan rollback salinan, total integrasi menjadi 35 pemeriksaan.

| Kelompok | Skenario yang sengaja dibuat gagal | Hasil yang diperiksa |
|---|---|---|
| Sebelum maintenance | `dirty`, `fetch-fail`, `unpublished-helper`, `target-drift`, `pid-drift`, `dynamic` | Ditolak tanpa stop service atau fast-forward kode/penulisan DB |
| Akun/data/konfirmasi | `bad-hash`, `bad-capacity`, `missing-odp-splitter`, `production-factory`, `warning-decline`, `warning-no-tty` | Tidak merotasi akun, menambah splitter, menurunkan mode atau melewati penolakan operator |
| Direktori backup | `backup-dir-unsafe` | Direktori existing yang bukan root:root-0700 ditolak, bukan di-chown/chmod diam-diam |
| Stop service gagal | `stop-fail` | Kode/DB tidak diperbarui; pesan **tidak dapat memastikan service berhenti**, bukan klaim palsu bahwa service sudah mati |
| Backup/proses lain | `backup-fail`, `other-reader` | Gagal sebelum perubahan kode; proses yang membuka hardlink DB terdeteksi melalui inode |
| Build/probe | `build-fail`, `probe-drift`, `probe-fail` | Tidak menyalakan kandidat pada DB asli; kegagalan/perubahan nilai dalam salinan terdeteksi, backup tidak di-reset |
| Startup/live | `start-fail`, `live-drift`, `env-drift` | Gagal ditandai; service dihentikan bila stop berhasil, backup tetap privat, tidak rollback otomatis |

Injeksi `live-drift` memang sengaja mengubah catatan **fixture** untuk menguji deteksi, bukan bukti bahwa penulisan salah mustahil terjadi. Bila penghentian proses sendiri gagal, operator harus memastikan semua penulis berhenti sebelum menyentuh DB.

## 4. Apa arti “akun/data tetap”?

Bukan berarti file SQLite harus byte-identik atau tidak boleh ada migrasi:

- Kolom/tabel baru diperbolehkan sepanjang seluruh nilai kolom lama, baris, ID eksplisit dan penghitung lama tetap cocok. Manifest tidak merupakan audit identik atas semua SQL DDL, indeks, view, trigger atau layout/rowid implisit SQLite.
- `sessions` dan `security_migrations` dikecualikan **secara eksplisit**. Migrasi keamanan dapat mencabut sesi; pengguna mungkin perlu login ulang. Tabel `users` tidak dikecualikan.
- Hash akun diverifikasi identik **sebelum login**. Login valid dapat mengganti hash SHA-256 lama menjadi scrypt tanpa mengganti password pengguna. Ini perilaku aplikasi yang sudah ada, bukan rotasi akun updater.
- Jika probe mengubah inventaris/field lama atau menemukan data yang perlu koreksi fisik, updater menunda. Tidak ada pembersihan, seed ulang, pemilihan receiver otomatis, atau reset agar pemeriksaan lolos.

`--preserve-accounts` hanya mengubah pemeriksaan preflight yang diminta eksplisit pada existing nonproduksi: password pabrik valid menjadi peringatan yang perlu diakui operator. **Preflight default, mode produksi, kebijakan password/login dan updater produksi ketat tetap ketat.** Lulus pelestarian bukan berarti password pabrik aman di LAN/internet.

## 5. Batas jaminan dan langkah Proxmox

1. **Belum menguji DB privat/new input Proxmox.** Sampel membantu mendeteksi regresi, bukan membuktikan semua ekstensi/keadaan lokal pasti kompatibel. Jaminan lebih tinggi: backup yang dapat direstore dan clone VM/LXC lokal terisolasi/IP berbeda, memakai DB lokal tanpa diunggah.
2. **Belum menguji systemd/OS/jaringan/disk/hardware Proxmox nyata.** Node Proxmox terakhir dilaporkan 22.23.3, sedangkan pengujian ini 22.22.3. Updater memeriksa runtime aktual 22.13+ dan menolak konfigurasi yang tidak didukung; tidak menebak PID/path/env.
3. **Belum memverifikasi cakupan citra Esri di lokasi nyata atau koneksi fisik OLT.** Browser memakai tile/jalur sintetis. Lulus fallback/zoom/KMZ bukan bukti satelit di koordinat lapangan selalu tersedia atau sambungan optik sudah benar.
4. Helper/panduan baru **belum ada dalam main yang hanya memuat PR #10**. Tinjau PR pendukung dan pastikan statusnya **Merged** terlebih dahulu; tidak ada merge otomatis. Jangan mencoba mengambil file yang belum dipublikasikan atau melewati guard dengan reset manual.
5. Navigasi langsung daftar ODC/ODP ke area input dari preview terdahulu **belum masuk PR #10** dan tidak ditambahkan oleh patch uji pelestarian ini. Jangan menganggap seluruh perubahan preview lama sudah ada di main.
6. Setelah helper masuk main, ikuti hanya [panduan existing](PERINTAH-UPDATE-PROXMOX.md): backup VM/lokal, hentikan input/login operator, launcher, baca peringatan, tunggu `UPDATE EXISTING SELESAI`, lalu cocokkan jumlah/isi **terakhir** dan login lama sebelum membuka input kembali. Tidak perlu unggah DB/password atau menjalankan pembuatan/rotasi akun untuk jalur ini.
7. Jika gagal sesudah maintenance, jangan memaksa start atau memulihkan kode saja. Pastikan penulis berhenti, simpan kondisi gagal dan uji pasangan kode+DB backup. Backup bisa belum lengkap jika stop/snapshot gagal; restore lama dapat membuang input setelah timestamp backup. Simpan konfigurasi/env/file eksternal lewat backup VM/lokal karena arsip updater bukan backup seluruh mesin.

## 6. Mengulang pengujian di lingkungan uji

```bash
npm ci
npm test
# Linux, pemilik checkout non-root, sudo -n atau runner root; bukan server produksi:
npm run test:update-existing
npm run test:update-native
npm run build
# Chromium lokal yang dependensi OS-nya tersedia:
CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:browser
CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:map:browser
CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:routes:browser
```

Harness membutuhkan objek Git kedua baseline di atas; shallow checkout perlu mengambil riwayatnya dahulu. Kandidat selalu mengambil file sumber aplikasi workspace saat pengujian, bukan diam-diam terus menguji versi merged lama setelah kode diubah.

Opt-in diagnosis: `FIBEROPS_TEST_ONLY=legacy-upgrade,modern-c320` memilih subset; `FIBEROPS_TEST_FAST=1` memock seluruh npm dan **bukan pengganti putaran penuh**. Filter kosong/tidak dikenal gagal, bukan melaporkan sukses kosong. Fixture sukses dibersihkan; fixture gagal atau `FIBEROPS_KEEP_UPGRADE_FIXTURES=1` disimpan untuk diagnosis. Backup/environment tetap dibatasi, tetapi fixture izin-longgar sengaja memiliki DB sampel readable untuk menguji peringatan. Seluruh datanya sintetis; jangan commit DB/artifak fixture.

Render smoke memerlukan server **demo sementara** terlebih dahulu karena tesnya memakai akun demo tetap. Putaran akhir di sini menjalankannya terhadap DB baru di direktori temp, lalu mematikan server dan menghapus temp. Jangan arahkan tes render ke Proxmox/DB existing dan jangan membuat akun demo di sana hanya untuk menjalankan tes.

Untuk browser di sandbox ini dipakai `CHROMIUM_ARGS='["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--no-zygote","--disable-gpu"]'` serta library/font bundle browser terpisah. Percobaan awal ANGLE/SwiftShader sempat timeout pada screenshot/navigasi; putaran lengkap terakhir software-rendering lulus 71/71 tanpa mematikan web security atau mengubah kode aplikasi. Percobaan render tanpa server juga ditolak dengan benar; hasil 12/12 adalah pengulangan dengan fixture sementara yang lengkap.
