# Peta Jaringan / KMZ

Menu **Peta Jaringan / KMZ** (`/peta`) menyatukan titik OLT, ODC, ODP dan **jalur kabel dari berkas KMZ/KML/XML/CSV Anda**. Ini peta geografis, terpisah dari diagram **Alur Core / Mapping Core**. Aplikasi tidak menemukan perangkat, melakukan geocoding alamat, atau menciptakan GPS/rute kabel.

**Tampilan awal sengaja bersih:** titik perangkat + kumpulan jalur yang pernah disimpan. Garis lurus hubungan skematis **mati secara bawaan**; catatan sambungan inventaris tidak dihapus.

## Cara menggunakan

1. Buka **Peta Jaringan / KMZ**. Angka atas menunjukkan jumlah perangkat bertitik dibanding seluruh inventaris untuk masing-masing jenis.
2. Ikon **OLT biru/bulat**, **ODC jingga/kabinet**, dan **ODP hijau/belah ketupat**. Angka pada lingkaran adalah jumlah perangkat yang dikelompokkan. Klik/perbesar grup untuk memisahkan ikon; beberapa ID pada koordinat sama tetap merupakan perangkat berbeda.
3. Klik ikon atau **Detail** pada daftar. Detail berisi ID, nama, GPS, lokasi asli, induk inventaris, catatan, serta bukti sambungan. **Buka OLT/ODC/ODP** menuju perangkat yang tepat; tautan ODP kini mendukung `?odp=ID`.
4. Filter **OLT induk inventaris**, **ODC induk inventaris**, jenis, atau nama/lokasi. Filter induk **bukan** pernyataan sumber fisik. Sebuah kabinet anak/bersama boleh menerima sumber dari jalur lain.
5. **Tampilkan Semua Titik** membersihkan semua filter dan menyesuaikan tampilan ke seluruh titik valid. Setelah perubahan inventaris/pemetaan oleh orang lain, tekan **Muat ulang peta**. Waktu data dibaca terlihat di atas kanvas; peta/ekspor memakai satu snapshot, bukan monitoring langsung.
6. Panel **Jalur kabel impor** menyediakan **Impor jalur kabel**, centang tampil/sembunyi per kumpulan, **Fokus**, **Fokus semua jalur**, serta **Telusuri segmen**. Detail menampilkan nama, ID segmen, sumber berkas, folder dan catatan asli; nama sama tidak digabung.
7. **Unduh KMZ Lengkap** berisi semua titik valid dan **semua jalur tersimpan**, termasuk kumpulan yang disembunyikan. **Unduh KMZ Terfilter** berisi titik yang cocok dengan filter + seluruh segmen pada kumpulan yang dicentang, bukan dipotong/ditautkan menurut induk OLT/ODC. Tombol mencantumkan jumlah titik dan segmen. Pencarian pada daftar segmen hanya membantu penelusuran, bukan mengurangi isi ekspor.

Tidak ada GPS perangkat yang valid? Daftar inventaris tetap tersedia dan peta tidak membuat titik default. Jalur impor tetap dapat ditampilkan/diekspor sendiri. Tombol ekspor dinonaktifkan hanya bila cakupannya tidak memiliki titik maupun jalur, atau data belum siap/bermasalah. Koordinat `0,0` hanya sah bila memang diberikan secara eksplisit, bukan pengganti nilai kosong.

## Mengimpor jalur kabel — tiga langkah

1. Admin/operator menekan **Impor jalur kabel**, lalu memilih berkas lokal **KMZ, KML/XML atau CSV**. Format dibaca berdasarkan isi; ekstensi ganda seperti `.xml.csv` juga dapat dibaca. Browser memproses berkas dalam worker sementara, **tanpa mengirim berkas mentah ke layanan luar**. Menutup dialog ketika pembacaan berlangsung membatalkannya.
2. Periksa **pratinjau bentuk**, jumlah segmen/titik pembentuk garis, nama kumpulan, dan contoh segmen. Bila ada bagian tidak didukung, ringkasan memberi peringatan dan meminta centang persetujuan sebelum simpan. Pratinjau visual disederhanakan; data simpan/ekspor tetap memakai seluruh koordinat yang valid.
3. Klik **Simpan jalur ke peta**. Sebelum langkah ini tidak ada jalur yang ditulis. Saat save pending input/tutup dikunci untuk mencegah submit ganda. Sesudah berhasil, kumpulan tersimpan di SQLite, peta memfokuskan areanya, dan tetap tersedia setelah reload/restart.

**Format yang didukung**

- **KML/XML:** dokumen KML dengan `Placemark/LineString`, termasuk beberapa LineString dalam `MultiGeometry`. Setiap garis tetap segmen terpisah; urutan vertex, altitude jika tersedia, nama, catatan, folder, serta warna `LineStyle`/`StyleMap normal` lokal dipertahankan. Warna pengganti lokal digunakan bila tidak tersedia. Ini bukan importer XML umum.
- **KMZ:** ZIP dengan `doc.kml` di akar, atau tepat satu KML di dalam arsip. Bila ada `doc.kml` dan KML lain, hanya dokumen utama dibaca, dengan peringatan. `NetworkLink`, style eksternal, gambar/overlay dan dokumen tertaut **tidak diunduh atau dijalankan**. Untuk jalur yang hanya berada di tautan luar, simpan sebagai KML mandiri terlebih dahulu.
- **CSV:** pemisah kolom koma; header `Name,Type,Coordinates` wajib, `Description` opsional (huruf besar/kecil tidak berpengaruh). `Type` berupa `line`/`linestring`. Sel `Coordinates` berisi tuple **longitude,latitude[,altitude]**, dipisahkan `;`, memakai titik desimal. Kutip CSV standar menangani koma, kutip ganda dan baris baru pada catatan. Contoh sintetis:

  ```csv
  Name,Type,Coordinates,Description
  "Kabel uji",line,"10,-5;10.01,-5.01;10.02,-5.015","Catatan uji, bukan inventaris"
  ```

**Perhatikan urutan sumbu:** berkas KML/CSV memakai **longitude lalu latitude**, berbeda dari dua kolom GPS perangkat. Aplikasi tidak menukar sumbu, melakukan geocoding atau menggeser garis agar dekat perangkat. Garis harus mempunyai minimal dua posisi berbeda, koordinat terbatas dalam rentang WGS84, dan data invalid ditolak seluruhnya, bukan disimpan separuh.

Point, Polygon, Track dan garis skematis dari ekspor aplikasi sendiri tidak menjadi jalur kabel. Bagian yang diabaikan dicatat pada pratinjau, metadata tersimpan, serta ekspor. Titik perangkat tidak diimpor dari KML/CSV ini. Teks nama/catatan ditampilkan sebagai teks aman, bukan HTML yang dijalankan.

**Pengelolaan kumpulan**

- Centang mengatur tampilan selama halaman peta dibuka; buka ulang halaman menampilkan semua kumpulan lagi. Sembunyi **bukan hapus** dan tidak mengurangi KMZ lengkap.
- **Telusuri segmen** bisa mencari nama/folder/kumpulan, memilih satu kumpulan, dan membuka detail/fokus. Daftar dipaginasi 20 segmen agar tidak memenuhi layar.
- Admin/operator dapat menghapus **satu kumpulan** setelah konfirmasi; hanya kumpulan dan segmennya dihapus. Simpan berkas sumber bila ingin impor kembali. Tidak ada penyambungan, penggabungan nama atau penggantian inventaris otomatis.
- Berkas dengan konten jalur yang identik dan berurutan sama ditolak sebagai duplikat walaupun nama berkas/kumpulan diganti. Ini bukan deteksi semua kabel fisik yang saling tumpang tindih.
- Setelah perubahan oleh pengguna lain, tekan **Muat ulang jalur**. Tidak ada polling otomatis. Bila daftar/geometri gagal, ada pesan dan retry; ekspor yang memerlukan data tersebut **gagal**, bukan menghasilkan arsip sukses yang diam-diam kurang jalur.
- Pembaca bisa melihat, memfokuskan dan mengekspor, tetapi tidak mengimpor/menghapus; API tetap memeriksa sesi, peran dan Origin.

**Batas untuk menjaga akses tetap ringan**

| Batas | Nilai |
|---|---|
| Berkas masuk | 3 MB |
| Total KML di KMZ setelah dibuka | 8 MB |
| Per impor | 500 segmen / 20.000 vertex |
| Payload JSON simpan | 900 KiB |
| Seluruh jalur tersimpan | 20 kumpulan / 2.000 segmen / 100.000 vertex |

Vertex adalah **titik pembentuk garis**, bukan perangkat atau port/core. Berkas besar perlu dibagi menjadi beberapa bagian; total kuota tetap berlaku. Parser dan ZIP ekspor memiliki batas waktu 30 detik dan dihentikan ketika dialog/halaman terkait ditinggalkan. Tidak ada fallback parsing berat ke main thread. Halaman peta dimuat lazy, daftar metadata terpisah dari geometri, maksimal tiga permintaan geometri bersamaan, cache dibatasi oleh kuota tersimpan, dan jalur digambar dengan **Canvas bersama**. Penyederhanaan hanya untuk tampilan; tidak mengurangi vertex yang disimpan/diekspor. Ini penjagaan arsitektur/batas data, **bukan jaminan kecepatan semua ponsel atau benchmark beban lapangan**.

> **Jalur mengikuti berkas impor, bukan bukti sambungan port/core.** Garis melewati/dekat OLT, ODC atau ODP tidak membuktikan hubungan. Impor tidak mengisi feeder/interface/core/splitter, menambah perangkat, mengganti ID, menimpa GPS, atau menyentuh akun.

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

Ada dua jenis garis yang **tidak boleh disamakan**:

- **Garis utuh berwarna:** geometri dari berkas impor. Belokan mengikuti vertex sumber, bukan hasil penarikan garis antarperangkat. Ketepatan fisiknya tetap perlu diperiksa terhadap sumber/survei lapangan.
- **Garis putus-putus skematis:** hubungan logis dari catatan sambungan. Default **mati**; hanya hidup bila pengguna membuka **Opsi lanjutan: hubungan perangkat** lalu mencentang **Koneksi skematis pada peta dan KMZ**. Opsi tidak menghapus/mengubah mapping.

> **Garis koneksi skematis bukan rute kabel fisik/GPS atau ukuran panjang kabel.** Aturan sumber berikut berlaku untuk skema logis, bukan untuk menyimpulkan hubungan dari jalur impor:

- **OLT → ODC** hanya muncul dari mapping **interface → core kabel feeder** yang valid: port milik OLT yang tepat, terdaftar pada feeder ODC, core dalam kapasitas, dan bukti tidak konflik. Keanggotaan OLT/daftar feeder/status aktif manual saja **tidak membuat garis sumber**.
- **ODC → ODP** dapat berasal dari kabel langsung tercatat atau output splitter. **ODC → ODC** tetap dibaca dengan ID receiver yang sebenarnya. Output dari splitter dalam ODP ke ODP berikutnya juga dipertahankan.
- Cascade dalam satu kabinet bukan kabel antarlokasi; tidak digambar sebagai titik/rute geografis baru. Sambungan keluarnya tetap ditampilkan.
- Satu garis merangkum satu pasangan perangkat berarah; seluruh bukti port, mapping, core, splitter, output, dan receiver dengan ID berbeda tetap ada dalam popup/detail/KMZ, termasuk bila nama splitternya sama. Ini **bukan hitungan jumlah kabel fisik**.
- Receiver belum dipilih/tidak valid atau dipakai beberapa output ditandai **perlu verifikasi**. Mapping interface konflik tidak dipromosikan menjadi sumber OLT. Catatan pemeriksaan tidak merapikan data secara otomatis.
- Garis memerlukan GPS valid pada **kedua** ujung. Yang belum lengkap tetap tercatat di detail, bukan disambung ke `0,0`. Bila salah satu ujung di luar filter, garis tidak ditarik.
- Peta tidak menyimpulkan bahwa semua core di kabinet berasal dari satu OLT. Nomor/warna core pada kabel berbeda tidak menyatukan jalur. Gunakan **Mapping Core / Alur Core** untuk penelusuran sumber per core dan verifikasi di lapangan.

## Peta dasar dan privasi

Peta dasar **nonaktif secara bawaan**. Titik dan jalur impor, pan/zoom, detail, daftar, skala geografis, serta KMZ bekerja tanpa layanan peta eksternal selama aplikasi/server lokal dapat diakses.

Centang **Aktifkan peta dasar OpenStreetMap (internet)** bila memerlukan latar jalan. Browser akan meminta tile dari `https://tile.openstreetmap.org`; penyedia dapat melihat IP, asal situs, dan area tampilan. Atribusi OpenStreetMap tetap ditampilkan. Ini bukan layanan penentu GPS perangkat dan tidak mengirim nama/catatan inventaris sebagai permintaan geocoding. Bila tile gagal, ada pemberitahuan; titik/detail/KMZ tetap berfungsi. Jangan mengandalkan tile publik untuk penggunaan offline massal atau unduhan area besar.

## Isi dan cakupan KMZ

KMZ adalah **ZIP sungguhan**, bukan PNG yang diganti ekstensi:

- `doc.kml` dengan namespace KML 2.2.
- Folder **OLT**, **ODC**, **ODP**, **Jalur kabel impor** (dikelompokkan per kumpulan), serta **Koneksi skematis — bukan rute kabel** hanya bila opsi lanjutannya hidup.
- Ikon PNG ketiga jenis dikemas lokal pada `icons/`; tidak bergantung CDN/ikon Google.
- Titik perangkat memakai urutan KML **longitude,latitude,0**, WGS84, `clampToGround`. LineString impor berisi **seluruh vertex sumber**, warna, nama, catatan, folder/provenance dan timestamp impor; altitude dipertahankan, atau ditulis 0 bila sumber 2D. Tampilan tetap `clampToGround`.
- Folder keterangan **Belum ada koordinat** berisi laporan teks; tidak menciptakan geometri/titik untuk perangkat tersebut.
- Nama/description, ID perangkat, sumber GPS, induk inventaris, bukti/receiver, waktu data dibaca (UTC), dan catatan cakupan ikut disimpan. Teks XML/HTML di-escape; tidak ada network link atau tautan sesi aplikasi.
- Centang **Koneksi skematis pada peta dan KMZ** hanya mengatur garis skematis pada keduanya. Opsi **tidak** menghapus jalur impor dari KMZ lengkap. Ekspor aplikasi memakai penanda jenis geometri agar skema tidak diimpor kembali sebagai kabel fisik.
- Ekspor lengkap selalu semua titik valid + semua jalur tersimpan. Ekspor terfilter mencantumkan filter titik + kumpulan jalur dicentang (seluruh segmennya). Pembatasan dua ujung dalam cakupan hanya berlaku pada skema logis. Akun, hash password, sesi/token, dan IP manajemen OLT **tidak** diekspor. Catatan yang sengaja dimasukkan ke berkas sumber tetap ikut, jadi periksa sebelum berbagi.

Buka `.kmz` melalui fasilitas **Open/Import** Google Earth yang mendukung berkas lokal, lalu pilih folder/ikon untuk membaca detail. Pengujian proyek memeriksa ZIP, XML, koordinat, ikon, dan unduhan browser; **bukan menjalankan aplikasi Google Earth asli**. Latar Google Earth bergantung aplikasi/cache/koneksinya sendiri, terpisah dari isi KMZ.

**KMZ berisi data jaringan privat (nama, lokasi, GPS, catatan).** Simpan/bagikan sesuai kebijakan operator. Pertimbangkan dampak privasi sebelum mengunggah berkas ke layanan pihak ketiga. Tidak ada KMZ produksi yang dibuat otomatis dari data uji; hasil ekspor aplikasi mengikuti inventaris pengguna sebenarnya.

## Update yang mempertahankan inventaris dan akun

Migrasi startup menambahkan `latitude REAL`, `longitude REAL` (nullable), serta `coordinate_mode` pada tiga tabel perangkat dalam **satu transaksi**. Mode awal membaca Lokasi lama, tanpa mengubah alamat, ID, timestamp lama, password, atau relasi. Instalasi yang sudah memiliki kolom GPS terpisah tetapi belum memiliki mode mempertahankan nilainya sebagai manual; nilai tidak valid tetap perlu diperbaiki, bukan diberi fallback.

Migrasi idempoten; kegagalan penambahan/pemindahan mode di tengah mengembalikan perubahan koordinat dan menggagalkan startup dengan pesan, bukan mereset DB. Jalur memakai tabel baru terpisah `map_route_imports` / `map_route_segments`, dengan insert/delete atomik; tidak ada mutasi/FK ke inventaris atau akun. Backup SQLite yang sama menyertakan jalur tersimpan. Konfigurasi runtime Docker ikut menyalin helper koordinat/jalur; parser XML/ZIP hanya di browser, server tetap tidak membutuhkan `node_modules`.

Tetap lakukan backup SQLite dan preflight sebelum update, sesuai [panduan update native](PERINTAH-UPDATE-PROXMOX.md) / [checklist pra-deploy](AUDIT-PRA-DEPLOY.md). **Jangan menghapus database, membuat ulang inventaris, atau mereset akun privat untuk mengaktifkan peta.** Fitur tidak mengubah aturan akun, C300/C320, format interface HSGQ/manual/PON, atau splitter ODP 1:8.

## Pengujian pengembang

```bash
npm ci
npm run build
npm test                    # termasuk 181 pemeriksaan peta/GPS/KMZ/jalur
npm run test:map             # 104 peta/GPS + 77 parser/store/API/worker/cache jalur
npm run test:routes          # 38 logika/store/KMZ + 14 HTTP + 12 worker + 13 cache/race
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:map:browser
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:routes:browser
```

Suite Chromium memakai DB sementara dengan bootstrap admin privat dan **data geografis sintetis khusus tes**. Ia memeriksa Leaflet/clustering sesungguhnya, 24 alur browser, desktop/mobile, tile/plugin gagal, ekspor lengkap/terfilter, sumber/receiver, tiga form inventaris, hak baca, pending/error save, clear/reload, dan ekspor yang selesai setelah logout. Tidak menggunakan DB/akun produksi. Jika server/browser berjalan serentak dengan suite lain, port dapat diatur melalui `UJI_MAP_API_PORT` / `UJI_MAP_BROWSER_PORT`; browser perlu dipasang pada lingkungan pengujian (tidak diunduh otomatis oleh suite).

Suite browser jalur menambahkan **21 pemeriksaan**: CSV 29 segmen/922 vertex sintetis, KML/KMZ worker nyata, MultiGeometry/warna/folder, pratinjau tanpa write, acknowledgement, simpan/hapus pending, duplikat, XSS/XXE/ZIP/batas berkas, reload/read-only, Canvas nyata, lengkap/terfilter/route-only, error/retry tanpa ekspor parsial, mobile, navigasi saat worker pending dan tidak ada request keluar. Untuk skenario pembatalan, input worker ditahan secara deterministik; alur impor/ekspor normal menjalankan worker sesungguhnya. Port terpisah `UJI_ROUTE_API_PORT` / `UJI_ROUTES_BROWSER_PORT`. Berkas jaringan pengguna tidak disertakan dalam fixture dan tidak diimpor otomatis.
