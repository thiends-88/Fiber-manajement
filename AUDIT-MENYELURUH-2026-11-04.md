# Audit menyeluruh — 4 November 2026

## Ringkasan

Audit source, API, keamanan sesi, konsistensi data, dan alur browser dilakukan pada
branch `arena/96dc269a-fiber-manajement`. **Tiga kelompok bug yang dapat direproduksi
diperbaiki**, disertai uji yang gagal sebelum perbaikan dan lulus sesudahnya.

**Hasil akhir pengujian dalam cakupan audit: lulus.** Ini bukan pernyataan bahwa
seluruh kemungkinan bug, konfigurasi produksi, atau sambungan fisik sudah bebas
masalah. Pengujian memakai database sementara dan geometri sintetis, bukan database
produksi atau berkas jaringan pribadi pengguna.

PR untuk ditinjau/merge: **https://github.com/thiends-88/Fiber-manajement/pull/10**.
Tidak dilakukan merge otomatis ataupun deployment produksi.

## Temuan dan perbaikan

### 1. Logout tampak berhasil meskipun pencabutan sesi belum dikonfirmasi

**Dampak:** kegagalan jaringan/HTTP sebelumnya ditelan oleh klien. Token lokal
dihapus dan pengguna dibawa ke login, tetapi cookie HttpOnly tidak dapat dihapus
JavaScript dan sesi server bisa tetap aktif. Header yang invalid juga dapat
menghalangi pembersihan cookie sah. Ketika header dan cookie berbeda, endpoint
sebelumnya hanya mencabut satu token.

**Perbaikan:**

- Klien hanya menganggap logout berhasil setelah menerima JSON `{ ok: true }`.
  Kegagalan jaringan, HTTP, atau respons rusak mempertahankan token untuk retry dan
  menampilkan peringatan **“Keluar belum dapat dikonfirmasi”**.
- Tombol terkunci selama permintaan berjalan. Peringatan menyediakan **Coba keluar
  lagi**, tanpa timer yang menghilangkan pesan penting tersebut.
- Endpoint logout idempotent: tetap mengirim cookie kedaluwarsa ketika sesi sudah
  tidak ada, termasuk jika header invalid. Endpoint ini tidak mengembalikan data
  pengguna. Endpoint data lainnya tetap memerlukan autentikasi dan header invalid
  tetap **tidak** berpindah akun melalui fallback cookie.
- Hanya token yang benar-benar dikirim pada Authorization, header aplikasi, dan
  cookie yang dicabut, secara atomik. Sesi browser lain yang tidak dikirim tetap
  berlaku; tidak ada pencabutan seluruh sesi akun.
- Guard same-origin/CSRF tetap dijalankan sebelum logout. Kegagalan penghapusan
  token kedua membatalkan seluruh transaksi dan tidak mengirim cookie sukses.
- Hasil logout lama tidak menghapus sesi baru yang sudah login.

**Bukti:** regresi klien menguji jaringan gagal, HTTP 503/401, `ok: false`, HTML,
retry, dan race sesi. Regresi API menguji logout berulang/tanpa sesi, beberapa token,
header invalid + cookie sah, rollback, dan Origin asing. Chromium nyata memeriksa
peringatan, submit ganda, cookie HttpOnly, retry, reload, serta sesi lain yang tetap
aktif.

### 2. Sambungan output ODP masih dapat membentuk lingkaran

**Dampak:** API menerima ODP menuju dirinya sendiri maupun A → B → A dan loop
multihop. Data tersebut tidak mewakili percabangan optik yang sah, meskipun renderer
memiliki penjaga agar tidak berulang tanpa batas.

**Perbaikan:**

- API menelusuri sambungan output antar-ODP yang benar-benar tercatat sebelum
  menerima target baru; self-loop, loop dua ODP, dan multihop ditolak HTTP 400
  sebelum mutasi.
- Penelusuran menggunakan visited-set dan tidak menganggap induk administratif
  `odc_id`, kemiripan nama, atau kedekatan GPS sebagai bukti sambungan.
- Form ODP tidak menawarkan dirinya sendiri atau arah ODC yang memang tidak
  didukung API. Sambungan ODC → ODP dan kelanjutan ODP yang sah tetap diterima.
- Penyimpanan catatan, pelepasan sambungan, dan koreksi target tetap tersedia.
  Penolakan tidak menghilangkan sambungan atau input form sebelumnya.

**Bukti:** uji self-loop, dua ODP, multihop/cabang, perubahan catatan, pelepasan,
sambungan ODC → ODP, serta alur error/koreksi melalui form Chromium nyata.

**Data lama tidak diubah otomatis.** Pencegahan berlaku pada penyimpanan target;
loop yang sudah ada sebelumnya memerlukan verifikasi dan koreksi oleh operator.

### 3. Akun dengan email yang tidak dapat dipakai login masih bisa dibuat

**Dampak:** pembuatan user tidak membatasi panjang email, sedangkan login membatasi
254 karakter. Akun dapat berhasil dibuat tetapi tidak bisa login. Pemeriksaan
panjang sebelum trim/huruf kecil juga tidak konsisten pada batas panjang dan pada
huruf Unicode tertentu yang memanjang ketika diubah menjadi huruf kecil.

**Perbaikan:** pembuatan akun dan login mengukur panjang setelah normalisasi yang
sama (huruf kecil dan trim), maksimal 254 karakter. Input email form user juga
memiliki `maxLength=254`. Penolakan terjadi sebelum insert/hashing akun baru.

**Bukti:** email di atas batas ditolak tanpa membuat akun; email valid tepat 254
karakter tetap dapat dibuat/login setelah trim dan perubahan huruf; email yang
memanjang setelah normalisasi ditolak sebelum insert. Tidak ada perubahan email,
password, role, atau ID akun existing. Akun legacy yang sudah bermasalah tidak
“diperbaiki” dengan mengganti identitas atau mereset password otomatis.

## Cakupan dan hasil pengujian

| Pemeriksaan                                            | Hasil                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `npm run build`                                        | Lulus; build produksi tersedia                                        |
| `npm test`                                             | Lulus; 622 keluaran pemeriksaan bertanda OK, tanpa kegagalan          |
| Regresi API audit (bagian `npm test`)                  | 27 skenario, termasuk 12 tambahan pada audit ini                      |
| Audit klien / UI (bagian `npm test`)                   | 10 / 22 skenario                                                      |
| Peta, GPS, satelit, KMZ, dan jalur (bagian `npm test`) | 193 pemeriksaan                                                       |
| Chromium produksi — aplikasi umum                      | 20 skenario, termasuk error/koreksi loop ODP dan logout gagal/retry   |
| Chromium produksi — peta                               | 29 skenario                                                           |
| Chromium produksi — impor/jalur/worker                 | 22 skenario                                                           |
| Total browser                                          | **71 skenario lulus**, web security tetap aktif                       |
| Render seluruh rute dan guard operator                 | **12 pemeriksaan lulus**, termasuk splitter ditunda 1.200 ms          |
| Updater native                                         | **15 skenario lulus**; Git/npm/systemctl dimock, SQLite/API/UID nyata |
| `npm audit --json`                                     | **0 vulnerability yang dilaporkan**                                   |
| `git diff --check`                                     | Lulus                                                                 |

Pengujian penuh mencakup login/role/session race, CRUD OLT/card/port/ODC/ODP,
feeder/interface/core, splitter/cascade/receiver, transaksi dan rollback, dashboard,
CSV/PDF, produksi tanpa dependensi npm, bootstrap/preflight/backup WAL, migrasi,
koordinat, impor KMZ/KML/CSV, cache geometri, pembatalan worker, dan ekspor KMZ yang
menolak keberhasilan parsial.

Pengujian browser peta memeriksa zoom tampilan sampai 22 dengan sumber tile maksimal
19, fallback induk yang dipotong benar, layar penuh desktop/mobile, atribusi,
filter/detail/GPS, kontrol role, XSS sebagai teks, dan unduhan KMZ. Pengujian jalur
memeriksa preview/konfirmasi, 29 segmen/922 vertex sintetis, warna/folder, nama sama
tetap terpisah, persistensi/reload/hapus, cache, dan ekspor seluruh data yang tidak
bergantung pada filter atau visibility. Tidak ada koneksi skematis pada peta/KMZ.

Log, bukti red/green, dan tangkapan layar pengujian tersimpan sebagai artefak lokal
sementara di `/home/user/.cache/fiber-full-audit-2026-11-04/`, bukan di Git. Fixture,
DB, dependensi browser, dan hasil build tidak dimasukkan ke PR.

## Batas verifikasi dan risiko yang masih perlu diperhatikan

1. **Produksi/Proxmox tidak diakses.** Versi Node, service systemd/Docker nyata,
   volume/izin DB, disk/RAM, backup-restore off-host, HTTPS, firewall, dan reverse
   proxy harus diverifikasi pada lingkungan sebenarnya sebelum update.
2. **Tidak ada sertifikasi fisik jaringan.** Shelf/slot/port ZTE C300/C320,
   card/kapasitas, receiver, patchcord dan sambungan lapangan tidak bisa dibuktikan
   dari source saja. Dukungan model lain/manual bukan hasil penemuan OLT otomatis.
3. **Citra Esri diuji dengan fixture tile.** Akses/cakupan/tanggal/resolusi citra
   nyata di lokasi pengguna belum diverifikasi. Zoom 20–22 adalah pembesaran, bukan
   penambahan detail asli. Fallback bekerja pada kegagalan gambar; tile abu-abu
   dengan HTTP 200 dari provider belum dapat dipastikan perilakunya di sini.
4. **Bundle utama masih besar:** sekitar 912,33 kB, gzip 281,21 kB. Warning batas
   500 kB tetap ada dan bukan kegagalan build. Peta tetap lazy, parser/ZIP berjalan
   di worker, dan audit ini tidak menambahkan dependensi aplikasi atau polling.
   Pemisahan lebih lanjut kode laporan/PDF layak dijadikan pekerjaan performa
   terpisah, terutama untuk koneksi lambat.
5. **Belum ada uji beban/pentest independen atau semua browser/perangkat fisik.**
   Tidak ditemukannya advisory npm tidak membuktikan semua kerentanan mustahil.
6. **Data legacy tidak dibersihkan otomatis.** Tidak dilakukan penghapusan
   inventaris/akun, rotasi password, penggantian GPS, inferensi koneksi, impor
   berkas pribadi, merge PR, atau deployment produksi. Koreksi data lapangan
   harus didasarkan pada bukti dan backup, bukan tebakan.
7. Saat audit ini dibuat, PR #10 belum memiliki CI checks yang terkonfigurasi.
   Hasil di atas berasal dari pengujian yang benar-benar dijalankan di workspace,
   bukan klaim bahwa GitHub Actions sudah hijau.

## Sebelum merge dan update

Tinjau diff PR, lalu lakukan merge secara manual bila sesuai. Sebelum menjalankan
update produksi, ikuti [DEPLOY-PROXMOX.md](DEPLOY-PROXMOX.md) dan
[PERINTAH-UPDATE-PROXMOX.md](PERINTAH-UPDATE-PROXMOX.md): backup konsisten, preflight
read-only, verifikasi volume/akun pribadi dan mode production, lalu smoke test serta
bandingkan inventaris/ID setelah restart. Jangan memakai database demo untuk
menggantikan database produksi.
