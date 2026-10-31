# Peta Jaringan / KMZ

Menu **Peta Jaringan / KMZ** (`/peta`) menyatukan OLT, ODC, dan ODP yang sudah tercatat. Ini peta geografis, terpisah dari diagram **Alur Core**. Aplikasi tidak menemukan perangkat, melakukan geocoding alamat, atau menciptakan GPS/rute kabel.

## Cara menggunakan

1. Buka **Peta Jaringan / KMZ**. Angka atas menunjukkan jumlah perangkat bertitik dibanding seluruh inventaris untuk masing-masing jenis.
2. Ikon **OLT biru/bulat**, **ODC jingga/kabinet**, dan **ODP hijau/belah ketupat**. Angka pada lingkaran adalah jumlah perangkat yang dikelompokkan. Klik/perbesar grup untuk memisahkan ikon; beberapa ID pada koordinat sama tetap merupakan perangkat berbeda.
3. Klik ikon atau **Detail** pada daftar. Detail berisi ID, nama, GPS, lokasi asli, induk inventaris, catatan, serta bukti sambungan. **Buka OLT/ODC/ODP** menuju perangkat yang tepat; tautan ODP kini mendukung `?odp=ID`.
4. Filter **OLT induk inventaris**, **ODC induk inventaris**, jenis, atau nama/lokasi. Filter induk **bukan** pernyataan sumber fisik. Sebuah kabinet anak/bersama boleh menerima sumber dari jalur lain.
5. **Tampilkan Semua Titik** membersihkan semua filter dan menyesuaikan tampilan ke seluruh titik valid. Setelah perubahan inventaris/pemetaan oleh orang lain, tekan **Muat ulang peta**. Waktu data dibaca terlihat di atas kanvas; peta/ekspor memakai satu snapshot, bukan monitoring langsung.
6. **Unduh KMZ Lengkap** membuat berkas seluruh titik valid pada snapshot, **tidak dibatasi filter peta**. **Unduh KMZ Terfilter** hanya aktif ketika ada filter dan titik yang cocok.

Tidak ada GPS valid? Daftar inventaris tetap tersedia, peta tidak membuat titik default, dan tombol ekspor dinonaktifkan. Koordinat `0,0` hanya sah bila memang diberikan secara eksplisit, bukan pengganti nilai kosong.

## Mengisi GPS tanpa merusak lokasi lama

Admin/operator dapat memakai tombol **GPS / Atur GPS** di peta, atau bagian **Koordinat peta · WGS84** pada form tambah/edit OLT, ODC, dan ODP. Peran pembaca tetap bisa melihat/mengunduh tetapi tidak mengubah GPS; API juga memeriksa hak tulis.

Tiga pilihan **Sumber koordinat peta**:

| Pilihan | Perilaku |
|---|---|
| **Baca dari Lokasi (termasuk data lama)** | Membaca format koordinat yang jelas dari teks Lokasi, tanpa menulis ulang teks tersebut. |
| **Isi latitude / longitude terpisah** | Menyimpan pasangan GPS baru, terpisah dari alamat. Latitude −90…90; longitude −180…180, dalam derajat WGS84. |
| **Tanpa titik peta** | Membersihkan GPS terpisah dan menonaktifkan titik. Lokasi asli tetap disimpan, termasuk bila berisi GPS lama; titik **tidak muncul lagi** setelah reload/restart. |

**Urutan input: latitude (lintang), lalu longitude (bujur).** Contoh format input, **bukan koordinat inventaris yang ditambahkan aplikasi**:

- Kolom terpisah: latitude `-0.7912`, longitude `100.6488`; koma desimal `-0,7912` dan `100,6488` juga diterima.
- Seluruh kolom Lokasi: `-0.7912, 100.6488`, `(-0.7912, 100.6488)`, atau `-0,7912;100,6488`.
- DMS eksplisit: `0°47'24"S, 100°38'24"E`.
- URL HTTPS Google Maps pada domain `google.com` dengan parameter titik `q=`/`query=` berisi pasangan angka juga dibaca tanpa mengunjungi URL.

Alamat biasa, teks campuran yang ambigu, tautan pendek, pusat viewport `@lat,lon`/`ll=`, angka tidak terbatas, dan urutan di luar rentang **tidak ditebak atau ditukar otomatis**. Untuk format lain, salin GPS yang sudah diverifikasi ke dua kolom terpisah. Memilih mode manual dari Lokasi yang terbaca akan menyalin pasangan tersebut ke form sebagai titik awal; penyimpanan tetap perlu dikonfirmasi.

Perangkat kosong, tidak valid, atau sengaja dinonaktifkan masuk ke **Belum ada koordinat**. GPS manual yang rusak tidak otomatis jatuh kembali ke Lokasi lama. Tombol GPS pada peta mengirim **hanya tiga field koordinat**, sehingga nama, alamat, model, induk, card/port, feeder, dan sambungan tidak dinormalisasi/ditulis ulang. Simpan yang masih pending mengunci form serta tombol tutup; kegagalan membuka kembali kontrol dan mempertahankan input.

## Arti garis — penting untuk kerja lapangan

> **Garis koneksi skematis dari catatan sambungan, bukan rute kabel fisik/GPS atau ukuran panjang kabel.**

- **OLT → ODC** hanya muncul dari mapping **interface → core kabel feeder** yang valid: port milik OLT yang tepat, terdaftar pada feeder ODC, core dalam kapasitas, dan bukti tidak konflik. Keanggotaan OLT/daftar feeder/status aktif manual saja **tidak membuat garis sumber**.
- **ODC → ODP** dapat berasal dari kabel langsung tercatat atau output splitter. **ODC → ODC** tetap dibaca dengan ID receiver yang sebenarnya. Output dari splitter dalam ODP ke ODP berikutnya juga dipertahankan.
- Cascade dalam satu kabinet bukan kabel antarlokasi; tidak digambar sebagai titik/rute geografis baru. Sambungan keluarnya tetap ditampilkan.
- Satu garis merangkum satu pasangan perangkat berarah; seluruh bukti port, mapping, core, splitter, output, dan receiver dengan ID berbeda tetap ada dalam popup/detail/KMZ, termasuk bila nama splitternya sama. Ini **bukan hitungan jumlah kabel fisik**.
- Receiver belum dipilih/tidak valid atau dipakai beberapa output ditandai **perlu verifikasi**. Mapping interface konflik tidak dipromosikan menjadi sumber OLT. Catatan pemeriksaan tidak merapikan data secara otomatis.
- Garis memerlukan GPS valid pada **kedua** ujung. Yang belum lengkap tetap tercatat di detail, bukan disambung ke `0,0`. Bila salah satu ujung di luar filter, garis tidak ditarik.
- Peta tidak menyimpulkan bahwa semua core di kabinet berasal dari satu OLT. Nomor/warna core pada kabel berbeda tidak menyatukan jalur. Gunakan **Mapping Core / Alur Core** untuk penelusuran sumber per core dan verifikasi di lapangan.

## Peta dasar dan privasi

Peta dasar **nonaktif secara bawaan**. Titik, pan/zoom, detail, daftar, skala geografis, serta KMZ bekerja tanpa layanan peta eksternal selama aplikasi/server lokal dapat diakses.

Centang **Aktifkan peta dasar OpenStreetMap (internet)** bila memerlukan latar jalan. Browser akan meminta tile dari `https://tile.openstreetmap.org`; penyedia dapat melihat IP, asal situs, dan area tampilan. Atribusi OpenStreetMap tetap ditampilkan. Ini bukan layanan penentu GPS perangkat dan tidak mengirim nama/catatan inventaris sebagai permintaan geocoding. Bila tile gagal, ada pemberitahuan; titik/detail/KMZ tetap berfungsi. Jangan mengandalkan tile publik untuk penggunaan offline massal atau unduhan area besar.

## Isi dan cakupan KMZ

KMZ adalah **ZIP sungguhan**, bukan PNG yang diganti ekstensi:

- `doc.kml` dengan namespace KML 2.2.
- Folder **OLT**, **ODC**, **ODP**, dan **Koneksi skematis — bukan rute kabel**.
- Ikon PNG ketiga jenis dikemas lokal pada `icons/`; tidak bergantung CDN/ikon Google.
- Titik memakai urutan KML **longitude,latitude,0**, WGS84, `clampToGround`.
- Folder keterangan **Belum ada koordinat** berisi laporan teks; tidak menciptakan geometri/titik untuk perangkat tersebut.
- Nama/description, ID perangkat, sumber GPS, induk inventaris, bukti/receiver, waktu data dibaca (UTC), dan catatan cakupan ikut disimpan. Teks XML/HTML di-escape; tidak ada network link atau tautan sesi aplikasi.
- Centang **Koneksi skematis pada peta dan KMZ** mengatur garis pada keduanya. Bila dimatikan, KMZ hanya memuat titik dan keterangannya.
- Ekspor lengkap selalu seluruh titik valid pada snapshot. Ekspor terfilter mencantumkan filter; garis hanya bila kedua perangkat masuk cakupan. Akun, hash password, sesi/token, dan IP manajemen OLT **tidak** diekspor.

Buka `.kmz` melalui fasilitas **Open/Import** Google Earth yang mendukung berkas lokal, lalu pilih folder/ikon untuk membaca detail. Pengujian proyek memeriksa ZIP, XML, koordinat, ikon, dan unduhan browser; **bukan menjalankan aplikasi Google Earth asli**. Latar Google Earth bergantung aplikasi/cache/koneksinya sendiri, terpisah dari isi KMZ.

**KMZ berisi data jaringan privat (nama, lokasi, GPS, catatan).** Simpan/bagikan sesuai kebijakan operator. Pertimbangkan dampak privasi sebelum mengunggah berkas ke layanan pihak ketiga. Tidak ada KMZ produksi yang dibuat otomatis dari data uji; hasil ekspor aplikasi mengikuti inventaris pengguna sebenarnya.

## Update yang mempertahankan inventaris dan akun

Migrasi startup menambahkan `latitude REAL`, `longitude REAL` (nullable), serta `coordinate_mode` pada tiga tabel perangkat dalam **satu transaksi**. Mode awal membaca Lokasi lama, tanpa mengubah alamat, ID, timestamp lama, password, atau relasi. Instalasi yang sudah memiliki kolom GPS terpisah tetapi belum memiliki mode mempertahankan nilainya sebagai manual; nilai tidak valid tetap perlu diperbaiki, bukan diberi fallback.

Migrasi idempoten; kegagalan penambahan/pemindahan mode di tengah mengembalikan perubahan koordinat dan menggagalkan startup dengan pesan, bukan mereset DB. Konfigurasi runtime Docker ikut menyalin helper koordinat; server tetap tidak membutuhkan `node_modules`.

Tetap lakukan backup SQLite dan preflight sebelum update, sesuai [panduan update native](PERINTAH-UPDATE-PROXMOX.md) / [checklist pra-deploy](AUDIT-PRA-DEPLOY.md). **Jangan menghapus database, membuat ulang inventaris, atau mereset akun privat untuk mengaktifkan peta.** Fitur tidak mengubah aturan akun, C300/C320, format interface HSGQ/manual/PON, atau splitter ODP 1:8.

## Pengujian pengembang

```bash
npm ci
npm run build
npm test                    # termasuk 104 skenario peta/GPS/KMZ
npm run test:map             # 60 logika/KMZ + 29 API/migrasi + 15 UI DOM
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:map:browser
```

Suite Chromium memakai DB sementara dengan bootstrap admin privat dan **data geografis sintetis khusus tes**. Ia memeriksa Leaflet/clustering sesungguhnya, 24 alur browser, desktop/mobile, tile/plugin gagal, ekspor lengkap/terfilter, sumber/receiver, tiga form inventaris, hak baca, pending/error save, clear/reload, dan ekspor yang selesai setelah logout. Tidak menggunakan DB/akun produksi. Jika server/browser berjalan serentak dengan suite lain, port dapat diatur melalui `UJI_MAP_API_PORT` / `UJI_MAP_BROWSER_PORT`; browser perlu dipasang pada lingkungan pengujian (tidak diunduh otomatis oleh suite).
