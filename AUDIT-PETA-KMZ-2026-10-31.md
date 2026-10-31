# Validasi Peta Jaringan / KMZ — 31 Oktober 2026

## Ruang lingkup

Fitur lanjutan setelah PR #9: satu menu `/peta` menggabungkan OLT/ODC/ODP yang memiliki koordinat valid dan menyediakan ekspor **KMZ lengkap**. Implementasi/pengujian dilakukan di branch `arena/96dc269a-fiber-manajement`, dari baseline `8e8aada`. Tidak melakukan merge otomatis, deploy, akses Proxmox, atau membaca/mengubah akun/database produksi.

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
- Semua garis diberi peringatan **skematis, bukan rute GPS/panjang kabel fisik**. Filter induk ditandai sebagai inventaris, bukan bukti sumber.

## Peta dan ekspor

- Leaflet 1.9.4 + markercluster 1.5.3 dimuat lazy, ikon PNG dibuat/dibundel lokal. Kanvas mempunyai stacking context sendiri; pane Leaflet tidak menutupi drawer/modal aplikasi.
- Peta dasar OpenStreetMap default **mati**, hanya opt-in dengan pemberitahuan privasi dan atribusi. Tile gagal tidak mematikan titik/detail/KMZ. Tidak ada geocoding atau pengiriman nama/catatan ke penyedia tile.
- Pengujian browser mengungkap callback `zoomToShowLayer` pada mode tanpa animasi dapat memisahkan lalu langsung menutup titik kolokasi saat `zoomend`. Fokus marker kini menyelesaikan pemisahan pada frame berikutnya; regresi memeriksa ketiga marker kolokasi benar-benar terlihat.
- Selector CSS cluster dinaikkan spesifisitasnya terhadap CSS Leaflet agar jumlah perangkat tetap berada di tengah, bukan tertimpa `display:block`. Posisi label juga diperiksa di browser.
- KMZ adalah ZIP dengan `doc.kml` KML 2.2 + tiga ikon PNG internal, folder OLT/ODC/ODP/koneksi dan laporan teks perangkat tanpa GPS. Urutan koordinat **longitude,latitude,0**; tidak ada geometri untuk perangkat yang belum memiliki GPS valid.
- Mode lengkap tidak mengikuti filter peta; mode terfilter berlabel filter dan hanya memuat garis dengan dua ujung dalam cakupan. Opsi garis berlaku pada peta dan KMZ.
- Popup memakai DOM `textContent`; data XML dan HTML balloon di-escape berlapis, termasuk CDATA-close, karakter kontrol, dan lone surrogate. KMZ tidak memasukkan akun, hash, sesi/token, app/session URL, IP manajemen OLT, atau aset remote.
- Aset ikon gagal/HTML fallback tidak menghasilkan arsip setengah lengkap. Timeout membuka kembali kontrol. Hasil ekspor yang selesai setelah komponen/sesi ditinggalkan tidak memicu unduhan terlambat. KMZ tetap merupakan **data jaringan privat** karena nama/GPS/lokasi/catatan sengaja disertakan.

## Hasil pengujian

Lingkungan: Node **22.22.3**, npm **10.9.8**, Vite **8.3.3**, Chromium **153.0.8010.0**. Seluruh DB pengujian terisolasi. Web security browser tetap aktif.

| Pemeriksaan | Hasil |
|---|---|
| Baseline sebelum perubahan: `npm ci`, build, `npm test` | Lulus |
| Validasi akhir dari instalasi bersih: `npm ci`, `npm run build` | Lulus |
| `npm test` (seluruh suite lama + baru) | Lulus |
| Logika koordinat, sumber grafik, ZIP/XML/ikon KMZ | **60/60** |
| API GPS, hak akses, snapshot read-only, migrasi dan rollback | **29/29** |
| UI peta/GPS dalam DOM (kanvas stub) | **15/15** |
| Browser produksi peta/Leaflet/KMZ/GPS, desktop/mobile | **24/24** |
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

## Preview dan batas verifikasi

Preview memakai **DB demo terpisah** dari inventaris pengguna; tidak menambahkan koordinat contoh ke sembilan perangkat demo. Browser/tes geografis memakai fixture terisolasi yang tidak dikemas ke aplikasi runtime. Permintaan lokal dengan Host preview eksternal dan Origin HTTPS memverifikasi login/snapshot/logout 200, Origin asing 403, dan route SPA `/peta` 200.

Batas yang tetap harus dipahami:

- Tidak menjalankan Google Earth asli; yang diverifikasi adalah format ZIP/KML 2.2, geometri, ikon, escaping, serta unduhan browser.
- Tile OpenStreetMap sengaja dibuat gagal pada pengujian untuk membuktikan degradasi aman, **bukan** sertifikasi ketersediaan/kapasitas penyedia. Peta web memakai proyeksi Web Mercator; lintang sangat dekat kutub mempunyai keterbatasan tampilan. Data KMZ tetap WGS84 asli.
- Smoke jsdom memakai stub kanvas geografis, bukan membuktikan rendering Leaflet; rendering sesungguhnya diuji pada Chromium.
- Smoke lama dengan jeda tetap 300 ms sempat gagal membaca cascade ODC saat empat suite berjalan serentak, masih pada status “Memuat splitter…”. Harness kini menunggu konten DOM sampai batas 5 detik; regresi juga dijalankan dengan respons splitter sengaja ditunda 750 ms. Tidak mengubah/memperlambat kode aplikasi.
- Build masih mengeluarkan peringatan chunk utama >500 kB yang juga ada pada baseline (peta/plugin lazy). Ini bukan kegagalan build. Peringatan eksperimental `node:sqlite` juga tetap ada.
- Audit npm nol advisori bukan jaminan bebas kerentanan. Pengujian satu Chromium bukan sertifikasi seluruh browser atau jaringan/perangkat lapangan berskala besar.
- Tidak memverifikasi GPS/rute kabel nyata, menjalankan survei, monitoring perangkat, Google Earth produksi, TLS/firewall Proxmox, Docker daemon, atau service systemd produksi. Uji updater memakai mock operasional, bukan deploy nyata.

Sebelum update produksi, merge melalui PR baru, backup SQLite dan ikuti preflight/checklist operasional yang sudah tersedia. Jangan menghapus DB atau mereset akun untuk mengaktifkan fitur ini.
