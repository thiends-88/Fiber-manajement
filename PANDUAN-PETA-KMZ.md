# Peta Jaringan / KMZ

Menu **Peta Jaringan / KMZ** (`/peta`) menyatukan titik OLT, ODC, ODP dan **jalur kabel dari berkas KMZ/KML/XML/CSV Anda**. Ini peta geografis, terpisah dari diagram **Alur Core / Mapping Core**. Aplikasi tidak menemukan perangkat, melakukan geocoding alamat, atau menciptakan GPS/rute kabel.

**Tampilan awal:** citra satelit Esri, titik perangkat dan kumpulan jalur yang pernah disimpan. **Koneksi skematis dihapus dari peta dan KMZ**, bukan hanya dimatikan secara bawaan. Catatan inventaris serta Mapping Core / Alur Core tetap utuh.

## Cara menggunakan

1. Buka **Peta Jaringan / KMZ**. Angka atas menunjukkan jumlah perangkat bertitik dibanding seluruh inventaris untuk masing-masing jenis.
2. Ikon **OLT biru/bulat**, **ODC jingga/kabinet**, dan **ODP hijau/belah ketupat**, dengan **nama perangkat tercatat selalu terlihat di samping simbol** tanpa klik/hover. Label mengikuti tema, tetap tampil saat peta digeser/diperbesar atau layar penuh, dan nama panjang membungkus agar lebih mudah dibaca di HP. Angka pada lingkaran adalah jumlah perangkat yang dikelompokkan; nama anggota baru muncul bersama ikonnya setelah grup dibuka/diperbesar agar tidak menumpuk saat ikhtisar. Beberapa ID pada koordinat sama tetap merupakan perangkat berbeda. Nama memakai snapshot peta yang sudah dibaca, tanpa request detail/core per perangkat atau penulisan inventaris.
3. **Klik ikon ODP:** popup langsung menampilkan **nama ODP**, **bulatan warna core power yang dipakai**, lalu **interface — ODC asal** (contoh `1/2/1 — ODC0001`). Tidak perlu membuka modal panjang. GPS, lokasi, induk inventaris dan catatan lengkap tetap di sidebar; **Detail** pada daftar / **Lihat detail sambungan ODP** pada sidebar adalah rincian opsional. Popup dan judul memakai nama perangkat tercatat, bukan label ID internal seperti `ODP #10`. **Buka OLT/ODC/ODP** tetap menuju perangkat yang tepat; ID/nama/GPS/mapping tidak diubah.
4. Filter **OLT induk inventaris**, **ODC induk inventaris**, jenis, atau nama/lokasi. Filter induk **bukan** pernyataan sumber fisik. Sebuah kabinet anak/bersama boleh menerima sumber dari jalur lain.
5. **Tampilkan Semua Titik** membersihkan semua filter dan menyesuaikan tampilan ke seluruh titik valid. Setelah perubahan inventaris/pemetaan oleh orang lain, tekan **Muat ulang peta**. Waktu data dibaca terlihat di atas kanvas; peta/ekspor memakai satu snapshot, bukan monitoring langsung.
6. Panel **Jalur kabel impor** menyediakan **Impor jalur kabel**, centang tampil/sembunyi per kumpulan, **Fokus**, **Fokus semua jalur**, serta **Telusuri segmen**. Detail menampilkan nama, ID segmen, sumber berkas, folder dan catatan asli; nama sama tidak digabung.
7. **Unduh KMZ Lengkap** berisi semua titik valid dan **semua jalur tersimpan**, termasuk kumpulan yang disembunyikan. **Unduh KMZ Terfilter** berisi titik yang cocok dengan filter + seluruh segmen pada kumpulan yang dicentang, bukan dipotong/ditautkan menurut induk OLT/ODC. Tombol mencantumkan jumlah titik dan segmen. Pencarian pada daftar segmen hanya membantu penelusuran, bukan mengurangi isi ekspor.

Tidak ada GPS perangkat yang valid? Daftar inventaris tetap tersedia dan peta tidak membuat titik default. Jalur impor tetap dapat ditampilkan/diekspor sendiri. Tombol ekspor dinonaktifkan hanya bila cakupannya tidak memiliki titik maupun jalur, atau data belum siap/bermasalah. Koordinat `0,0` hanya sah bila memang diberikan secara eksplisit, bukan pengganti nilai kosong.

## Membuka peta layar penuh

Klik **Peta layar penuh** di sudut kanan bawah peta. Peta akan memenuhi viewport aplikasi, menutupi menu/sidebar sehingga titik dan jalur lebih leluasa dibaca. Mode ini juga bekerja pada preview iframe dan ponsel tanpa meminta izin Fullscreen browser.

- Pan/zoom, titik, jalur, popup dan pilihan peta dasar tetap dipertahankan; tidak ada pembuatan ulang peta atau pengambilan geometri ulang hanya karena ukuran berubah. Tile citra untuk bagian viewport yang baru tetap dapat dimuat.
- Gunakan **Keluar layar penuh** di kanan atas atau tombol **Esc** untuk kembali. Guliran halaman dan fokus keyboard dipulihkan; Tab tetap berada pada kontrol peta selama mode aktif.
- Klik ikon ODP tetap membuka popup singkat **di dalam peta layar penuh**, tanpa keluar dari mode ini atau membuka modal. **Lihat detail** pada popup OLT/ODC dan **Detail jalur** tetap kembali ke tampilan biasa untuk membuka panel terkait. Layar penuh tidak mengubah filter, inventaris, koordinat, jalur tersimpan atau isi KMZ.

## Popup ODP sederhana

Cukup klik ikon ODP pada peta. Tampilan normal hanya berisi:

```text
ODP-0026
Core power  ● C7
1/2/1 — ODC0001
```

Bulatan mengikuti **warna core kabel ODP sendiri**, bukan warna feeder ODC. Nomor core tetap tertulis agar tidak bergantung pada warna saja; arahkan pointer ke ikon atau gunakan pembaca layar untuk nama warna, tube, dan keterangan apakah statusnya tercatat terpakai atau terdeteksi dari sambungan. Core idle/cadangan/rusak yang tidak memiliki pemakaian terdeteksi tidak ikut sebagai core terpakai. Tidak ada penulisan ulang status manual.

Baris sumber memakai **interface dan ODC terakhir pada jalur tersimpan yang sah**, bukan sekadar ODC induk inventaris. Nama OLT tersedia pada keterangan baris sumber. Untuk HSGQ tampil `PON 3`, dan nama interface manual tetap mengikuti input. Beberapa pasangan sumber yang berbeda tetap ditampilkan; pasangan interface/ODC identik dipadatkan berdasarkan ID, bukan kesamaan nama. Rincian jalur asli tidak digabung/diubah.

Belum ada mapping? Popup menulis **Interface belum dipetakan** atau **Interface / ODC asal belum dipetakan**. Konflik diberi **Asal perlu verifikasi**; jika hanya sebagian jalur lengkap, ada catatan singkat. Tidak menebak asal dari nama, GPS, induk, warna core, atau garis impor. Core belum diisi juga tidak diberi warna/nomor pengganti.

Popup dan datanya dimuat hanya ketika dibuka, melalui satu snapshot `GET /api/map-data?odp_id=ID` yang sama dengan rincian lanjutan. Buka ulang untuk membaca data baru; tidak ada polling atau fetch semua core saat peta pertama tampil. Respons popup yang sudah ditutup/diganti/sesinya berubah tidak dipasang ke popup lain. Gagal baca menyediakan **Coba lagi** tanpa data lama yang dianggap terbaru. Popup tetap di dalam peta pada mode layar penuh dan ponsel.

### Rincian lanjutan (opsional)

Untuk penelusuran lebih jauh, gunakan **Detail** pada daftar ODP (termasuk yang belum memiliki GPS), atau **Lihat detail sambungan ODP** pada sidebar. Modal **Detail sambungan ODP** tetap tersedia, tetapi bukan langkah wajib untuk membaca nama/core/interface/ODC dari ikon.

- **Ringkasan di atas:** OLT dan interface asal yang berhasil ditelusuri, ODC yang dilewati, core feeder, serta core power terpakai/terdeteksi. Sumber yang belum terkonfirmasi tidak dimasukkan sebagai asal pasti. Jika ada beberapa jalur, rincian tetap terpisah dan jalur terpetakan ditampilkan terlebih dahulu.
- **Urutan sambungan:** OLT → interface → ODC/core → splitter/rasio/output → ODC penerima/cascade bila tercatat → ODP. Kabel langsung menampilkan nomor core ODC **dan** core ODP yang sebenarnya, bukan menyamakan keduanya. Nama interface mengikuti profil yang tersimpan: C300/C320, PON langsung (misalnya HSGQ), atau nama manual.
- **Tiga penanda:** **Asal terpetakan**, **Hulu belum lengkap**, dan **Perlu verifikasi**. Mapping hilang, feeder terlepas, receiver/core/output tidak sah, input ganda atau jalur berputar tidak disembunyikan atau dipilih salah satunya secara otomatis. **Terpetakan berarti bukti logis tersimpan, bukan hasil pengukuran atau verifikasi fisik lapangan.**
- **Core power ODP — kabel ODP sendiri:** nomor, warna dan tube mengikuti tipe kabel ODP itu. Daftar lengkap berisi status tersimpan (termasuk idle/cadangan/rusak), tujuan dan catatan yang diinput. **Terpakai terdeteksi dari sambungan** ditampilkan terpisah; tidak menulis ulang status manual. Splitter lokal dengan input yang tercatat tetap dapat ditampilkan walau hulunya belum lengkap.
- **Core masuk yang belum diketahui tetap kosong:** output splitter → ODP belum menyimpan nomor core tujuan. Aplikasi tidak mengisinya dengan nomor core feeder, warna yang sama, atau core power lokal. Asal sebuah splitter lokal hanya dapat dilanjutkan melalui core masuk yang benar-benar terikat pada sambungan.
- **Induk inventaris** tersedia pada bagian lipat terpisah, bukan bukti asal fisik. Nama sama, koordinat berdekatan, serta garis kabel impor juga bukan bukti sambungan. Membuka detail tidak menambah garis skematis pada peta/KMZ.

**Core power adalah penandaan core kabel, bukan nilai daya optik dBm atau estimasi redaman.** Field pengukuran legacy tidak diaktifkan atau dihapus dari DB. Panel tidak melakukan SSH/SNMP atau mengambil pengukuran langsung dari OLT.

Gunakan **Muat ulang detail** setelah input sambungan berubah. Waktu snapshot terlihat di bawah panel; panel bukan monitoring langsung. Setiap pembukaan/refresh membaca satu snapshot konsisten melalui `GET /api/map-data?odp_id=ID`, termasuk core milik ODP terpilih saja, bukan sembilan request inventaris terpisah. Kontrak peta biasa tetap sama. Jika gagal/ODP dihapus, pesan dan tombol coba lagi ditampilkan, bukan asal/core lama yang dianggap terbaru. Respons terlambat setelah panel ditutup/perangkat diganti diabaikan.

Panel dimuat lazy, tanpa dependensi baru atau polling. Penelusuran dibatasi 24 jalur, kedalaman 32 dan 512 kunjungan; batas tercapai diberi catatan untuk melanjutkan pemeriksaan di Mapping Core. **Tutup / Esc** mengembalikan fokus dan guliran halaman. Tombol **Buka input ODP** dan **Buka Mapping Core** menuju halaman lama dengan aturan peran yang sama; membuka panel/tautan tidak menyimpan data. Admin, operator dan pembaca dapat membaca detail sesuai sesi aplikasi.

Fitur detail ini tidak menambah migrasi/tabel, mengganti akun/password, mengimpor berkas privat, mengisi koordinat, atau menulis ulang inventaris/core/mapping yang sudah ada.

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

Point, Polygon, Track dan garis skematis dari **ekspor aplikasi versi lama** tidak menjadi jalur kabel. Bagian yang diabaikan dicatat pada pratinjau, metadata tersimpan, serta ekspor. Titik perangkat tidak diimpor dari KML/CSV ini. Teks nama/catatan ditampilkan sebagai teks aman, bukan HTML yang dijalankan.

**Pengelolaan kumpulan**

- Centang mengatur tampilan selama halaman peta dibuka; buka ulang halaman menampilkan semua kumpulan lagi. Sembunyi **bukan hapus** dan tidak mengurangi KMZ lengkap.
- **Telusuri segmen** bisa mencari nama/folder/kumpulan, memilih satu kumpulan, dan membuka detail/fokus. Daftar dipaginasi 20 segmen agar tidak memenuhi layar.
- Admin/operator dapat menghapus **satu kumpulan** setelah konfirmasi; hanya kumpulan dan segmennya dihapus. Simpan berkas sumber bila ingin impor kembali. Tidak ada penyambungan, penggabungan nama atau penggantian inventaris otomatis.
- Berkas dengan konten jalur yang identik dan berurutan sama ditolak sebagai duplikat walaupun nama berkas/kumpulan diganti. Ini bukan deteksi semua kabel fisik yang saling tumpang tindih.
- Setelah perubahan oleh pengguna lain, tekan **Muat ulang jalur**. Tidak ada polling otomatis. Bila daftar/geometri gagal, ada pesan dan retry; ekspor yang memerlukan data tersebut **gagal**, bukan menghasilkan arsip sukses yang diam-diam kurang jalur.
- Pembaca bisa melihat, memfokuskan dan mengekspor, tetapi tidak mengimpor/menghapus; API tetap memeriksa sesi, peran dan Origin.

**Batas untuk menjaga akses tetap ringan**

| Batas                           | Nilai                                       |
| ------------------------------- | ------------------------------------------- |
| Berkas masuk                    | 3 MB                                        |
| Total KML di KMZ setelah dibuka | 8 MB                                        |
| Per impor                       | 500 segmen / 20.000 vertex                  |
| Payload JSON simpan             | 900 KiB                                     |
| Seluruh jalur tersimpan         | 20 kumpulan / 2.000 segmen / 100.000 vertex |

Vertex adalah **titik pembentuk garis**, bukan perangkat atau port/core. Berkas besar perlu dibagi menjadi beberapa bagian; total kuota tetap berlaku. Parser dan ZIP ekspor memiliki batas waktu 30 detik dan dihentikan ketika dialog/halaman terkait ditinggalkan. Tidak ada fallback parsing berat ke main thread. Halaman peta dimuat lazy, daftar metadata terpisah dari geometri, maksimal tiga permintaan geometri bersamaan, cache dibatasi oleh kuota tersimpan, dan jalur digambar dengan **Canvas bersama**. Penyederhanaan hanya untuk tampilan; tidak mengurangi vertex yang disimpan/diekspor. Ini penjagaan arsitektur/batas data, **bukan jaminan kecepatan semua ponsel atau benchmark beban lapangan**.

> **Jalur mengikuti berkas impor, bukan bukti sambungan port/core.** Garis melewati/dekat OLT, ODC atau ODP tidak membuktikan hubungan. Impor tidak mengisi feeder/interface/core/splitter, menambah perangkat, mengganti ID, menimpa GPS, atau menyentuh akun.

## Mengisi GPS tanpa merusak lokasi lama

Admin/operator dapat memakai tombol **GPS / Atur GPS** di peta, atau bagian **Koordinat peta · WGS84** pada form tambah/edit OLT, ODC, dan ODP. Peran pembaca tetap bisa melihat/mengunduh tetapi tidak mengubah GPS; API juga memeriksa hak tulis.

Tiga pilihan **Sumber koordinat peta**:

| Pilihan                                   | Perilaku                                                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Baca dari Lokasi (termasuk data lama)** | Membaca format koordinat yang jelas dari teks Lokasi, tanpa menulis ulang teks tersebut.                                                                          |
| **Isi latitude / longitude terpisah**     | Menyimpan pasangan GPS baru, terpisah dari alamat. Latitude −90…90; longitude −180…180, dalam derajat WGS84.                                                      |
| **Tanpa titik peta**                      | Membersihkan GPS terpisah dan menonaktifkan titik. Lokasi asli tetap disimpan, termasuk bila berisi GPS lama; titik **tidak muncul lagi** setelah reload/restart. |

**Urutan input: latitude (lintang), lalu longitude (bujur).** Contoh format input, **bukan koordinat inventaris yang ditambahkan aplikasi**:

- Kolom terpisah: latitude `-0.7912`, longitude `100.6488`; koma desimal `-0,7912` dan `100,6488` juga diterima.
- Seluruh kolom Lokasi: `-0.7912, 100.6488`, `(-0.7912, 100.6488)`, atau `-0,7912;100,6488`.
- DMS eksplisit: `0°47'24"S, 100°38'24"E`.
- URL HTTPS Google Maps pada domain `google.com` dengan parameter titik `q=`/`query=` berisi pasangan angka juga dibaca tanpa mengunjungi URL.

Alamat biasa, teks campuran yang ambigu, tautan pendek, pusat viewport `@lat,lon`/`ll=`, angka tidak terbatas, dan urutan di luar rentang **tidak ditebak atau ditukar otomatis**. Untuk format lain, salin GPS yang sudah diverifikasi ke dua kolom terpisah. Memilih mode manual dari Lokasi yang terbaca akan menyalin pasangan tersebut ke form sebagai titik awal; penyimpanan tetap perlu dikonfirmasi.

Perangkat kosong, tidak valid, atau sengaja dinonaktifkan masuk ke **Belum ada koordinat**. GPS manual yang rusak tidak otomatis jatuh kembali ke Lokasi lama. Tombol GPS pada peta mengirim **hanya tiga field koordinat**, sehingga nama, alamat, model, induk, card/port, feeder, dan sambungan tidak dinormalisasi/ditulis ulang. Simpan yang masih pending mengunci form serta tombol tutup; kegagalan membuka kembali kontrol dan mempertahankan input.

## Arti garis dan data mapping — penting untuk kerja lapangan

Garis pada peta hanya **geometri dari berkas jalur impor**. Belokan mengikuti vertex sumber, bukan penarikan garis antarperangkat. Ketepatan fisiknya tetap perlu diperiksa terhadap sumber/survei lapangan.

**Tidak ada garis hubungan skematis atau opsi untuk mengaktifkannya**, baik pada peta maupun KMZ. Membuka grup titik kolokasi juga tidak menggambar garis pendamping yang menyerupai kabel. Hubungan inventaris tidak otomatis menciptakan jalur GPS.

Catatan sambungan dan bukti logis tetap ada pada detail perangkat serta **Mapping Core / Alur Core**, bukan dijadikan geometri kabel:

- Sumber OLT memerlukan mapping **interface → core kabel feeder** yang valid: pemilik port, pendaftaran feeder, kapasitas serta bukti tidak konflik. Induk inventaris, warna/nomor core atau feeder saja bukan bukti sumber.
- Kabel langsung/output splitter, ODC → ODC, cascade kabinet dan ODP downstream tetap memakai ID receiver yang sebenarnya. Nama splitter sama tidak menyatukan bukti.
- Receiver invalid/terpakai ganda atau mapping konflik tetap perlu verifikasi. Tidak ada pengisian sumber berdasarkan kedekatan geografis/nama kabel.
- Citra/jalur impor tidak membuktikan semua core di satu kabinet berasal dari satu OLT. Gunakan penelusuran per core dan verifikasi lapangan.

## Citra satelit, zoom dan privasi

**Esri World Imagery aktif saat halaman Peta dibuka**, menggantikan OpenStreetMap. Citra tidak dimuat dari dashboard. Hilangkan centang **Tampilkan citra satelit Esri (internet)** untuk menghemat kuota; titik/jalur, pan/zoom, detail, skala dan KMZ tetap bekerja selama aplikasi dapat diakses.

**Angka 50 m / 20 m di sudut peta adalah panjang skala jarak**, bukan ketinggian kamera atau ketelitian GPS. Kamera kini dapat diperbesar sampai **level 22**, sekitar **8× lebih dekat secara linear** daripada batas level 19 sebelumnya. Fit otomatis tetap menggunakan tampilan lebih luas agar perangkat/jalur tidak terpotong. Memilih titik atau memakai tombol `+`/scroll dapat memperbesar lebih dekat.

Citra sumber tetap diminta paling tinggi pada level 19, kemudian diperbesar oleh Leaflet. Jika tile detail tidak tersedia, aplikasi mencoba paling banyak **dua tile induk** beresolusi lebih rendah untuk petak yang gagal saja. Potongan kuadrannya diperbesar dengan offset yang tepat, bukan meregangkan seluruh gambar induk ke setiap petak. Kamera, koordinat perangkat dan bentuk jalur tidak diubah. Tidak ada polling, unduhan wilayah massal, API tilemap tambahan, atau paket aplikasi baru.

URL tile HTTPS: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false`. Urutannya zoom/baris/kolom; `blankTile=false` meminta kegagalan daripada gambar placeholder “Map data not yet available”, agar fallback dapat bekerja. Bila seluruh upaya gagal, ada pemberitahuan; titik/detail/KMZ tidak ikut hilang. Fallback terbatas ini bukan jaminan seluruh lokasi memiliki citra.

Penyedia dapat melihat IP, asal situs dan area tampilan. Nama/catatan inventaris, data port/core dan autentikasi aplikasi tidak dimasukkan ke URL/header tile. Atribusi **Esri / Maxar / Earthstar Geographics / GIS User Community** tetap terlihat di ponsel dan layar penuh. Buffer tile kecil dan pembaruan saat idle; tidak meminta resolusi retina ganda.

**Zoom tambahan tidak menambah ketajaman, umur citra atau akurasi GPS.** Ada pemberitahuan ketika citra diperbesar/diganti sumber lebih rendah; gambar dapat tampak pecah. Citra bukan real-time atau bukti survei. Resolusi, cakupan, tanggal dan ketersediaan bergantung penyedia. Ikuti kebijakan layanan/lisensinya; aplikasi tidak menyediakan cache offline massal atau jaminan layanan. Citra tidak dikemas dalam KMZ.

## Isi dan cakupan KMZ

KMZ adalah **ZIP sungguhan**, bukan PNG yang diganti ekstensi:

- `doc.kml` dengan namespace KML 2.2.
- Folder **OLT**, **ODC**, **ODP**, dan **Jalur kabel impor** (dikelompokkan per kumpulan). Tidak ada folder, Placemark atau style koneksi skematis.
- Ikon PNG ketiga jenis dikemas lokal pada `icons/`; tidak bergantung CDN/ikon Google.
- Titik perangkat memakai urutan KML **longitude,latitude,0**, WGS84, `clampToGround`. LineString impor berisi **seluruh vertex sumber**, warna, nama, catatan, folder/provenance dan timestamp impor; altitude dipertahankan, atau ditulis 0 bila sumber 2D. Tampilan tetap `clampToGround`.
- Folder keterangan **Belum ada koordinat** berisi laporan teks; tidak menciptakan geometri/titik untuk perangkat tersebut.
- Nama/description, ID perangkat, sumber GPS, induk inventaris, catatan, provenance jalur, waktu data dibaca (UTC), dan catatan cakupan ikut disimpan. Teks XML/HTML di-escape; tidak ada network link atau tautan sesi aplikasi.
- LineString hanya untuk jalur impor. Impor ulang KML lama tetap mengabaikan geometri berpenanda skematis, sehingga tidak berubah menjadi kabel fisik.
- Ekspor lengkap selalu semua titik valid + semua jalur tersimpan. Ekspor terfilter mencantumkan filter titik + kumpulan jalur dicentang (seluruh segmennya). Akun, hash password, sesi/token, dan IP manajemen OLT **tidak** diekspor. Catatan yang sengaja dimasukkan ke berkas sumber tetap ikut, jadi periksa sebelum berbagi.

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
npm test                    # termasuk peta/GPS/KMZ, detail ODP dan jalur
npm run test:map             # satelit/fallback, peta/GPS, detail ODP, parser/store/API/worker/cache jalur
npm run test:odp-detail      # 43 penelusuran/kontrak + 26 UI popup/rincian ODP (bagian dari npm test)
npm run test:routes          # 38 logika/store/KMZ + 14 HTTP + 12 worker + 13 cache/race
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:map:browser
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:routes:browser
```

Suite Chromium memakai DB sementara dengan bootstrap admin privat dan **data geografis sintetis khusus tes**. Ia memeriksa Leaflet/clustering sesungguhnya, 35 alur browser, desktop/mobile, label nama OLT/ODC/ODP tanpa hover/klik, grup dibuka/ditutup, nama panjang/XSS, filter/clear serta pan/resize tanpa fetch tambahan; zoom 22, fallback citra, tile/plugin gagal, ekspor lengkap/terfilter, sumber/receiver, popup ODP sederhana yang tetap di layar penuh, core/icon/interface/ODC (320/390px dan pembaca), serta rincian opsional dengan refresh GET-only dan fokus/Esc, tiga form inventaris, pending/error save, clear/reload, dan ekspor yang selesai setelah logout. Tidak menggunakan DB/akun produksi. Jika server/browser berjalan serentak dengan suite lain, port dapat diatur melalui `UJI_MAP_API_PORT` / `UJI_MAP_BROWSER_PORT`; browser perlu dipasang pada lingkungan pengujian (tidak diunduh otomatis oleh suite).

Suite browser jalur menambahkan **22 pemeriksaan**: CSV 29 segmen/922 vertex sintetis, KML/KMZ worker nyata, MultiGeometry/warna/folder, pratinjau tanpa write, acknowledgement, simpan/hapus pending, duplikat, XSS/XXE/ZIP/batas berkas, reload/read-only, Canvas nyata, lengkap/terfilter/route-only, error/retry tanpa ekspor parsial, mobile, navigasi saat worker pending dan tidak ada request luar yang tidak diharapkan. Untuk skenario pembatalan, input worker ditahan secara deterministik; alur impor/ekspor normal menjalankan worker sesungguhnya. Port terpisah `UJI_ROUTE_API_PORT` / `UJI_ROUTES_BROWSER_PORT`. Berkas jaringan pengguna tidak disertakan dalam fixture dan tidak diimpor otomatis.

Sepuluh regresi satelit memeriksa URL/zoom, batas fallback, offset potongan induk, callback lama dan pembatalan saat hide/unmount. Suite browser memeriksa zoom sampai 22, request tetap ≤19, skala lebih dekat dari 20 m, fallback HTTP 404 pada level 19/18 ke induk 17 tanpa perubahan GPS/mapping, serta kredit/layar penuh lebar 320/390px. Tile sukses menggunakan **PNG sintetis/transparan**, bukan citra nyata. Ketersediaan/resolusi layanan Esri langsung dan Google Earth asli **tidak** diverifikasi. Opsi legacy `includeConnections: true` tetap diuji agar tidak dapat mengaktifkan kembali ekspor skema.
