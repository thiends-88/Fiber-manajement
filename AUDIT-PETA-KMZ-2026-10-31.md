# Validasi Peta Jaringan / KMZ — 31 Oktober 2026

## Ruang lingkup

Fitur lanjutan setelah PR #9: satu menu `/peta` menggabungkan OLT/ODC/ODP yang memiliki koordinat valid dan menyediakan ekspor **KMZ lengkap**. Kelanjutan pada PR #10 menambahkan **impor jalur KMZ/KML/XML/CSV terpisah** dan mematikan skema lurus secara bawaan sesuai persetujuan pengguna. Implementasi/pengujian dilakukan di branch `arena/96dc269a-fiber-manajement`, dari baseline `8e8aada`. Tidak melakukan merge otomatis, deploy, akses Proxmox, atau membaca/mengubah akun/database produksi.

Panduan operasional: [PANDUAN-PETA-KMZ.md](PANDUAN-PETA-KMZ.md).

## Perubahan dan penjagaan data

- Tambahan nullable `latitude`/`longitude` dan `coordinate_mode` (`location`, `manual`, `none`) pada tiga tabel perangkat, dalam satu transaksi startup yang idempoten. Tidak membuat contoh GPS atau mengubah kolom Lokasi lama. Nilai GPS terstruktur yang sudah ada tidak dibuang.
- Legacy Lokasi berupa pasangan desimal/DMS eksplisit/parameter titik Google Maps dibaca tanpa geocoding atau penulisan ulang. Alamat, tautan pendek, pusat viewport, rentang tidak sah, dan urutan ambigu tidak dipromosikan menjadi posisi.
- Mode `none` menahan fallback Lokasi meskipun teks lama berisi koordinat. Nilai kosong bukan `0,0`; pasangan nol eksplisit tetap sah secara WGS84.
- PATCH khusus GPS hanya mengubah tiga field GPS dan `updated_at` perangkat terkait. Nama/alamat/model/kolom tambahan, ID, card/port, feeder, splitter, core, dan relasi lain tidak dinormalisasi sebagai efek samping. Hak tulis divalidasi kembali setelah pembacaan body; pasangan PATCH parsial dibaca dari row terkini.
- Snapshot baca `/api/map-data` memerlukan sesi dan memakai transaksi konsisten. Tidak menyertakan tabel akun/sesi. API runtime tetap tanpa dependensi npm; Docker menyalin helper koordinat baru.
- Form OLT, ODC (dua jalur edit), dan ODP memakai field GPS bersama. Tautan `/odp?odp=ID` kini memilih ODP yang tepat. Model/interface C300/C320/HSGQ/manual/PON dan splitter ODP 1:8 tidak diubah.

## Kebenaran titik dan sambungan

- Identitas titik adalah **jenis + ID**, bukan nama/GPS unik; perangkat pada lokasi sama tidak dideduplikasi.
- Snapshot menggunakan LEFT JOIN agar GPS valid tidak hilang hanya karena induk inventaris legacy tidak ditemukan. Tes raw-DB FK rusak gagal sebelum perbaikan dan lulus sesudahnya; tidak menciptakan garis atau memperbaiki induk diam-diam. Fixture dibersihkan sebelum tes berikutnya.
- OLT→ODC memerlukan mapping interface→core feeder yang valid (pemilik port, pendaftaran feeder, kapasitas, serta konflik input/port/core). Keanggotaan OLT atau daftar feeder saja tidak menimbulkan garis.
- Kabel langsung, output splitter ke ODP, ODC→ODC dengan receiver yang tercatat, cascade dalam kabinet, ODP downstream, dan kabinet bersama tetap dibaca menurut catatan/ID. Tidak menebak receiver melalui nomor/warna core.
- Garis mengagregasi pasangan perangkat, bukan menghitung kabel fisik; setiap bukti tetap memuat ID mapping/port/splitter/output/receiver agar nama yang sama tidak menghapus bukti berbeda.
- Receiver invalid/terpakai ganda ditandai perlu verifikasi. Mapping sumber yang konflik tidak digambar sebagai sumber OLT. Garis memerlukan dua GPS valid dan dua ujung dalam filter. Koneksi tanpa geometri tetap dapat dilihat dalam detail.
- Garis hubungan inventaris diberi peringatan **skematis, bukan rute GPS/panjang kabel fisik** dan kini default mati di opsi lanjutan. Jalur impor utuh berwarna ditandai sebagai geometri sumber berkas, bukan bukti port/core. Filter induk ditandai sebagai inventaris, bukan bukti sumber.

## Peta dan ekspor

- Leaflet 1.9.4 + markercluster 1.5.3 dimuat lazy, ikon PNG dibuat/dibundel lokal. Kanvas mempunyai stacking context sendiri; pane Leaflet tidak menutupi drawer/modal aplikasi.
- Peta dasar OpenStreetMap default **mati**, hanya opt-in dengan pemberitahuan privasi dan atribusi. Tile gagal tidak mematikan titik/detail/KMZ. Tidak ada geocoding atau pengiriman nama/catatan ke penyedia tile.
- Pengujian browser mengungkap callback `zoomToShowLayer` pada mode tanpa animasi dapat memisahkan lalu langsung menutup titik kolokasi saat `zoomend`. Fokus marker kini menyelesaikan pemisahan pada frame berikutnya; regresi memeriksa ketiga marker kolokasi benar-benar terlihat.
- Selector CSS cluster dinaikkan spesifisitasnya terhadap CSS Leaflet agar jumlah perangkat tetap berada di tengah, bukan tertimpa `display:block`. Posisi label juga diperiksa di browser.
- KMZ adalah ZIP dengan `doc.kml` KML 2.2 + tiga ikon PNG internal, folder OLT/ODC/ODP, jalur impor, skema opsional dan laporan teks perangkat tanpa GPS. Titik berurutan **longitude,latitude,0**; LineString impor mempertahankan semua tuple/altitude sumber (0 bila 2D). Tidak ada geometri untuk perangkat yang belum memiliki GPS valid.
- Mode lengkap tidak mengikuti filter/centang visibilitas: semua titik valid + semua kumpulan jalur tersimpan. Mode terfilter berisi titik terfilter + seluruh segmen pada kumpulan dicentang. Skema hanya bila opsi lanjutannya hidup, dengan dua ujung dalam cakupan. Kegagalan mengambil daftar/geometri menggagalkan ekspor, bukan menghasilkan KMZ setengah lengkap.
- Popup memakai DOM `textContent`; data XML dan HTML balloon di-escape berlapis, termasuk CDATA-close, karakter kontrol, dan lone surrogate. KMZ tidak memasukkan akun, hash, sesi/token, app/session URL, IP manajemen OLT, atau aset remote.
- Aset ikon gagal/HTML fallback tidak menghasilkan arsip setengah lengkap. Timeout membuka kembali kontrol. Hasil ekspor yang selesai setelah komponen/sesi ditinggalkan tidak memicu unduhan terlambat. KMZ tetap merupakan **data jaringan privat** karena nama/GPS/lokasi/catatan sengaja disertakan.

## Jalur impor: kebenaran data dan akses ringan

- `map_route_imports` / `map_route_segments` terpisah dari seluruh tabel inventaris/akun. Insert satu batch + semua segmen dan delete cascade memakai transaksi atomik; ID segmen berbeda meski nama sama. Hash kanonik menolak batch identik berurutan sama meski nama berkas/kumpulan berubah atau altitude 0 ditulis eksplisit. Tidak melakukan deduplikasi spasial/penggabungan kabel.
- API `/api/route-imports` mengirim metadata tanpa koordinat, GET `/:id` mengambil satu geometri. Tidak membundel jalur ke dashboard atau `/api/map-data`. Baca memerlukan sesi; tulis admin/operator dengan pemeriksaan sesi/peran ulang setelah pembacaan body dan penjagaan Origin yang sama dengan API lama. Respons privat `no-store`, tanpa token URL.
- Berkas dibaca berdasarkan isi, bukan hanya ekstensi. CSV mendukung BOM/CRLF, kutip/koma/newline dan ekstensi ganda. KML mendukung namespace, Folder, MultiGeometry, style lokal serta altitude. KMZ memeriksa daftar entri/ukuran expanded/nama dokumen ambigu sebelum membuka dokumen terpilih. Tidak mengekstrak berkas ke disk atau mengambil URL/aset luar.
- DOCTYPE/XXE, XML rusak/kedalaman berlebih, CSV ambigu, koordinat tidak terbatas/di luar rentang, garis nol, dan data melebihi batas ditolak. Point/Polygon/Track/NetworkLink diabaikan dengan peringatan; tanpa garis mandiri tidak ada impor. Warnings tersimpan dan memerlukan acknowledgement di pratinjau.
- Pratinjau tidak menulis apa pun. Save/delete pending mengunci kontrol, kegagalan mempertahankan input dan bisa dicoba lagi. Nama/folder/catatan selalu teks aman. Layer memiliki fokus, show/hide, pencarian/filter kumpulan, paginasi 20 segmen dan detail ID. Hak baca tidak menampilkan kontrol tulis; API tetap menolak write langsung.
- Tidak membuat/menebak GPS atau perangkat; tidak mengisi feeder, interface, core, splitter, receiver atau hubungan OLT. Kedekatan geografis/nama/warna kabel tidak menjadi bukti sumber. Geometri asli dipertahankan, terlepas dari penyederhanaan visual.
- Seluruh halaman Peta, Leaflet, dialog dan parser dimuat sesuai kebutuhan. Impor XML/ZIP dan ekspor XML/ZIP berjalan pada worker sementara, timeout 30 detik, transferable buffer dan terminasi saat selesai/cancel/navigasi. Tidak ada fallback parsing berat di main thread. Pembacaan berkas yang selesai setelah worker dibatalkan tidak diposting ulang.
- Geometri hanya untuk kumpulan terlihat/diperlukan ekspor, cache immutable dengan eviction batch terhapus, maksimum tiga permintaan bersamaan, tanpa polling. Guard generasi/session/unmount menolak respons lama. Ekspor lengkap juga mengambil kumpulan tersembunyi; kegagalan tidak ditelan sebagai ekspor sukses.
- Canvas renderer bersama untuk jalur; preview maksimal 80 garis dengan sampling, daftar maksimal 20 entri per halaman. Simpan/ekspor **tidak** memakai sampling. Batas 3 MiB berkas / 8 MiB KML dalam arsip / 900 KiB payload / 500 segmen dan 20.000 vertex per impor; total 20 batch / 2.000 segmen / 100.000 vertex. Cache/batas ini bukan benchmark ponsel atau sertifikasi beban maksimum.
- Ekspor menyertakan warna, folder, catatan, provenance/waktu, warnings dan penanda jenis geometri. Roundtrip ekspor sendiri mempertahankan catatan/folder asli dan mengabaikan skema sebagai kabel. Tidak menganggap koordinat hasil impor sebagai hasil survei yang telah dikonfirmasi.

## Hasil pengujian

Lingkungan: Node **22.22.3**, npm **10.9.8**, Vite **8.3.3**, Chromium **153.0.8010.0**. Seluruh DB pengujian terisolasi. Web security browser tetap aktif. Instalasi bersih, build, seluruh suite di tabel, smoke normal/delayed, serta updater **dijalankan ulang setelah ekstensi jalur**; bukan hanya hasil historis tahap peta awal.

| Pemeriksaan | Hasil |
|---|---|
| Baseline sebelum perubahan: `npm ci`, build, `npm test` | Lulus |
| Validasi akhir dari instalasi bersih: `npm ci`, `npm run build` | Lulus |
| `npm test` (seluruh suite lama + baru) | Lulus |
| Logika koordinat, sumber grafik, ZIP/XML/ikon KMZ | **60/60** |
| API GPS, hak akses, snapshot read-only, migrasi dan rollback | **29/29** |
| UI peta/GPS dalam DOM (kanvas stub) | **15/15** |
| Parser/validator/store/ZIP/KMZ jalur sintetis | **38/38** |
| API jalur HTTP production, atomik, restart, roles/revoke/logout | **14/14** |
| Worker impor/ekspor, cancel/timeout/respons rusak/late read | **12/12** |
| Hook React cache/concurrency/generation/session/mutasi/StrictMode | **13/13** |
| Browser produksi peta/Leaflet/KMZ/GPS, desktop/mobile | **24/24** |
| Browser produksi jalur: worker/Canvas/impor/ekspor/mobile | **21/21** |
| Browser regresi lama: auth, dashboard, CRUD pending, CSV/PDF, CSRF/proxy | **18/18** |
| Smoke render semua rute, termasuk `/peta` | **11 rute + pembatasan operator**, lulus |
| Updater native pada lingkungan uji | **15/15**, Git/npm/systemctl dimock |
| Tata letak runtime dari manifest COPY Docker, tanpa node_modules | Lulus (termasuk suite produksi/preflight) |
| `npm audit --json` | **0 advisori diketahui** pada pemeriksaan ini |
| `git diff --check` | Lulus |

Suite lama mencakup logika 70, API 117, logika interface 20, API interface 99 permintaan, laporan interface 22, UI interface, audit klien 8/API 15/UI 20, dashboard API 15/UI 16, keamanan 17, pra-deploy API 24/CLI 16, regresi atomik/otorisasi API 15, serta regresi DOMPurify 19. Tidak menjumlahkannya sebagai satu angka karena beberapa suite memakai cara menghitung berbeda.

### Bukti preservasi migrasi

Pada DB uji berisi inventaris/relasi/akun:

1. Simulasikan skema sebelum GPS dan tambahkan kolom ekstensi `asset_tag`; siapkan akun privat fixture dengan hash lama SHA256.
2. Bandingkan seluruh row menurut kolom lama sebelum/sesudah startup menggunakan digest, termasuk ID, timestamp, hash, sesi, metadata keamanan, dan semua relasi. Tidak ada perbedaan kolom lama.
3. Restart ulang dan bandingkan seluruh snapshot (termasuk GPS baru): identik. `quick_check = ok`, foreign-key check bersih.
4. Login salah mempertahankan hash lama; hanya login valid meng-upgrade hash tanpa mengganti identitas akun, sesuai aturan existing.
5. Paksa kegagalan trigger pada tabel kedua saat migrasi parsial: penambahan skema/isi koordinat sebelumnya ikut rollback, akun/inventaris tidak direset. Setelah trigger fixture dilepas, GPS terstruktur lama tetap dipertahankan sebagai manual.
6. Periksa setiap jenis perangkat: PATCH GPS-only tidak mengubah tabel lain/kolom non-GPS. Mode `none` tetap berlaku setelah restart meskipun Lokasi masih berisi pasangan GPS.

Ini bukti pada **DB sintetis**, bukan audit database produksi pengguna.

### Cakupan browser peta

Memakai DB production sementara yang di-bootstrap dengan admin privat, lalu membuat **fixture geografis khusus tes**, bukan mengubah seed aplikasi. Awalnya 11 titik valid dan 3 tanpa GPS; tiga ID berlainan sengaja kolokasi. Pemeriksaan meliputi:

- unauth redirect dan snapshot terlindungi; menu/semua jenis/angka cluster dan marker kolokasi;
- popup XSS sebagai teks; filter inventaris, pencarian nol hasil, reset/fit semua;
- unduhan file KMZ nyata, lengkap meski terfilter, folder/ikon/koordinat, tidak ada garis OLT palsu dari feeder saja;
- ODC anak/bersama, receiver, downstream ODP, PON HSGQ dan GPON shelf/slot/port;
- ekspor terfilter, opsi garis, ikon rusak dan retry, tile gagal;
- pending/error save GPS, blok Escape/backdrop/X/submit ganda, input tidak hilang, reload snapshot;
- clear GPS legacy, ketiga form CRUD, query detail ODP, splitter 1:8;
- snapshot gagal menutup ekspor stale, mobile tanpa overflow, drawer/modal di atas Leaflet;
- pembaca dengan cache profil admin palsu tetap read-only; API menolak PATCH;
- logout saat aset ekspor ditahan, data tanpa GPS sama sekali, plugin peta gagal, tidak ada token URL atau exception JavaScript tak tertangani.

### Cakupan browser jalur dan sampel

**21 alur** memakai DB production sementara dan koordinat buatan: 29 segmen/922 vertex CSV, kemudian KML dan KMZ mandiri. Browser menjalankan worker ZIP/XML dan Canvas sesungguhnya; memeriksa preview tanpa POST, acknowledgement, simpan/hapus tertunda, duplikat, nama sama/ID berbeda, XSS sebagai teks, file invalid/XXE/NetworkLink/batas ukuran tanpa request luar, re-login pembaca, reload/persistensi, lengkap meski tersembunyi, terfilter hanya kumpulan dicentang, dan jalur saja tanpa marker perangkat rekaan. Error index/geometri tidak menimbulkan retry tanpa batas atau file parsial; retry memulihkan. Mobile 390px tidak overflow dan modal berada di atas Canvas. Untuk pembatalan navigasi, input worker ditahan secara deterministik agar terminasi/no-download dapat diperiksa; alur normal menggunakan worker sebenarnya.

Sampel lampiran pengguna juga dibaca dan divalidasi **lokal saja**, tanpa auto-import ke DB preview/produksi. Tidak memasukkan koordinat atau berkas jaringan tersebut ke Git/fixture. Semua geometri yang dikomit untuk tes adalah sintetis.

Build akhir: main **911,49 kB / gzip 280,95 kB**; chunk Peta **44,70 kB / gzip 14,02 kB**; worker impor **44,05 kB**, worker KMZ **18,67 kB**. Uji browser dashboard membuktikan tidak ada request chunk Peta/Leaflet/worker atau metadata/geometri jalur sebelum menu peta dibuka. Ukuran bundle bukan pengukuran waktu akses pada perangkat lapangan.

## Preview dan batas verifikasi

Preview memakai **DB lokal terpisah dari produksi**; inventaris, akun dan sesi yang sudah ada di preview dipertahankan. Tidak menambahkan contoh GPS/jalur atau mengimpor lampiran pengguna otomatis. DB/artefak cache tetap gitignored. Browser/tes geografis memakai fixture terisolasi, tidak dikemas ke runtime. Pemeriksaan awal Host preview/Origin HTTPS login/snapshot/logout dan Origin asing tetap tercakup regresi; probe akhir pada preview aktif hanya GET: health 200, SPA `/peta` 200, metadata tanpa sesi 401/dengan sesi yang sudah ada 200 (`no-store`, tanpa koordinat), snapshot inventaris 200, serta dua aset worker lokal 200 dengan MIME JavaScript. Tidak login ulang atau mencabut sesi pengguna untuk probe ini.

Batas yang tetap harus dipahami:

- Tidak menjalankan Google Earth asli; yang diverifikasi adalah format ZIP/KML 2.2, geometri, ikon, escaping, serta unduhan browser.
- Tile OpenStreetMap sengaja dibuat gagal pada pengujian untuk membuktikan degradasi aman, **bukan** sertifikasi ketersediaan/kapasitas penyedia. Peta web memakai proyeksi Web Mercator; lintang sangat dekat kutub mempunyai keterbatasan tampilan. Data KMZ tetap WGS84 asli.
- Smoke jsdom memakai stub kanvas geografis, bukan membuktikan rendering Leaflet; rendering sesungguhnya diuji pada Chromium.
- Smoke lama dengan jeda tetap 300 ms sempat gagal membaca cascade ODC saat empat suite berjalan serentak, masih pada status “Memuat splitter…”. Harness kini menunggu konten DOM sampai batas 5 detik; regresi juga dijalankan dengan respons splitter sengaja ditunda 750 ms. Tidak mengubah/memperlambat kode aplikasi.
- Build masih mengeluarkan peringatan chunk utama >500 kB yang juga ada pada baseline (peta/plugin lazy). Ini bukan kegagalan build. Peringatan eksperimental `node:sqlite` juga tetap ada.
- Audit npm nol advisori bukan jaminan bebas kerentanan. Pengujian satu Chromium bukan sertifikasi seluruh browser atau jaringan/perangkat lapangan berskala besar.
- Tidak memverifikasi GPS/rute kabel nyata, menjalankan survei, monitoring perangkat, Google Earth produksi, TLS/firewall Proxmox, Docker daemon, atau service systemd produksi. Uji updater memakai mock operasional, bukan deploy nyata.

Perubahan dilanjutkan pada **PR #10 yang terbuka**, bukan membuat PR baru atau merge/deploy otomatis. Sebelum update produksi, review/merge PR yang sesuai, backup SQLite dan ikuti preflight/checklist operasional yang sudah tersedia. Jangan menghapus DB atau mereset akun untuk mengaktifkan fitur ini.
