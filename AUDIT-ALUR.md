# Audit alur aplikasi — 19 Oktober 2026

> Dokumen historis audit 19 Oktober. Audit lanjutan **20 Oktober 2026**, termasuk
> Chromium nyata, worker/canvas PDF build produksi, keamanan dan deployment,
> ada di **[AUDIT-PRA-DEPLOY.md](AUDIT-PRA-DEPLOY.md)**. Batas pengujian di bawah
> menggambarkan kondisi pada saat audit ini, bukan hasil audit lanjutan.

## Ringkasan

Audit mencakup login/sesi/peran, Dashboard, OLT/card/port, ODC–ODP, assignment core, interface feeder, kabel langsung, splitter/cascade/receiver ODC anak, penelusuran dan diagram, laporan CSV/PDF, serta navigasi dan kondisi gagal muat.

**Temuan di bawah sudah diperbaiki, dengan regresi otomatis.** Lulusnya pengujian bukan jaminan aplikasi bebas seluruh bug atau pengganti pengecekan sambungan di lapangan.

Pengujian lama awalnya lulus, tetapi belum mencakup beberapa kasus penting. Reproduksi backend baru sebelum perbaikan menghasilkan **11 kasus gagal**; kasus rasio nonteks dan pencampuran ringkasan receiver kemudian juga direproduksi secara terpisah. Pengujian UI terhadap arsip sumber sebelum audit turut menangkap `ReferenceError: setOdcId is not defined` dan respons perangkat lama yang menimpa pilihan baru.

## Temuan dan perbaikan

| Prioritas | Alur / masalah | Perbaikan |
| --- | --- | --- |
| Kritis | Hapus splitter memakai ID splitter untuk membersihkan `target_odc_id`; ID yang kebetulan sama dapat menghapus catatan arah ODC lain. | Hilangkan pembersihan yang salah. Hanya referensi splitter yang dihapus yang dibersihkan; penghapusan receiver tetap mempertahankan rute ODC dengan receiver kosong. |
| Tinggi | Mengecilkan rasio splitter menghapus output tersambung atau catatan tanpa peringatan. | Tolak dengan 409 bila output yang akan dipangkas masih berisi sambungan/catatan. Output benar-benar kosong tetap boleh dipangkas. |
| Tinggi | PATCH splitter dapat memakai ID induk lain untuk lolos validasi kapasitas, padahal splitter tetap di induk asli. | Induk tidak dapat diganti melalui PATCH; kapasitas selalu dibaca dari induk sebenarnya. |
| Tinggi | Receiver ODC anak dapat sekaligus diberi input cascade lokal. | Periksa kedua jenis input agar satu splitter tidak menerima dua sumber. |
| Tinggi | Cascade/receiver baru dapat mengambil alih splitter yang masih memakai feeder terpetakan. | Minta pengguna melepaskan mapping feeder atau memilih receiver lain terlebih dahulu. |
| Tinggi | Setelah mapping dibuat, link atau splitter baru bisa membuat core feeder yang sudah terbukti menjadi input ganda. | Validasi juga saat penambahan link, penambahan splitter, dan pengubahan input splitter. |
| Tinggi | Data dan modal Core/Splitter Manager dapat terbawa saat berganti ODC/ODP; respons terlambat dapat menimpa data pilihan baru. | Pisahkan siklus komponen per induk/tipe kabel, abaikan respons lama, dan kunci penyuntingan core selama memuat/gagal muat. |
| Tinggi | Profil/peran localStorage dipakai sebagai bukti login; profil usang bisa menampilkan kontrol yang tidak semestinya. | Verifikasi `/api/me` sebelum membuka halaman terlindungi. Peran server menjadi acuan. Backend tetap merupakan penjaga izin; sebelumnya pun cache bukan cara melewati izin backend. |
| Tinggi | Token header/parameter tetap berlaku setelah batas cookie tujuh hari; 401/logout lama dapat menghapus sesi baru. | Terapkan umur maksimum tujuh hari di server dan pengenal generasi sesi di klien. Respons sesi lama tidak mengeluarkan login baru. |
| Sedang | Pemilih ODC di Mapping memanggil setter yang tidak tersedia. | Gunakan parameter URL sebagai satu sumber pilihan ODC, termasuk pilihan kosong. |
| Sedang | Link yang dimuat untuk ODC lama dapat tampil di ODC baru; penelusuran global menerima link parsial. | Muat daftar link jaringan dan turunkan tampilan terpilih dari ID ODC, bukan respons fetch pilihan lama. |
| Sedang | Ringkasan Mapping menggabungkan dua receiver bernomor core sama, lalu menempelkan seluruh ODP ke satu receiver terakhir. | Simpan semua pohon per core dan hitung tujuan per ID akar/receiver. Cabang kabel berbeda tetap terpisah. |
| Sedang | Reload setelah simpan port dapat menampilkan card/port OLT yang sebelumnya dipilih. | Periksa ID OLT aktif sebelum menerapkan hasil reload card/port. |
| Sedang | Jumlah core, deteksi pemakaian, tabel interface feeder dan asal ODP dapat tertinggal setelah perubahan. | Sinkronkan ulang panel terkait setelah penyimpanan/penghapusan; beri perlindungan respons lama pada panel feeder. |
| Sedang | Submit berulang sebelum request selesai bisa membuat ODP/splitter atau perubahan lain terkirim dua kali. | Gunakan penjaga submit berbasis ref, status menyimpan, tombol nonaktif dan penutupan modal yang menunggu penyimpanan. |
| Sedang | JSON/HTML rusak dianggap sukses dengan data null; request macet dapat menggantung tanpa batas. | Tampilkan error respons tidak valid dan batasi request 30 detik dengan pesan coba ulang. |
| Sedang | Rasio berbentuk array lolos validasi lalu menghasilkan error binding SQLite 500. | Wajibkan rasio teks yang sah; input nonteks menjadi 400 dan spasi pada teks dinormalisasi. |
| Rendah | PDF Rekap menampilkan pencarian tersembunyi dari tab lain dan tidak mencatat filter segmen/status. | Metadata memakai filter tab aktif, dibungkus sesuai lebar halaman; panah diubah menjadi teks yang tersedia pada font PDF. |
| Rendah | Timer toast antar-komponen saling membatalkan; label form dan dialog kurang mendukung keyboard. | Timer per-hook, label terhubung ke input, dialog berlabel, fokus terkunci di dialog, Escape dan pengembalian fokus. |

### Aturan lapangan yang tetap dipertahankan

- Nomor/warna core yang sama **tetap boleh** dipakai receiver ODC anak berbeda pada kabel masuk berbeda. Identitas receiver, bukan kesamaan warna, yang membedakan cabang.
- Bila membuat receiver di kabinet yang sudah memiliki feeder terpetakan pada nomor core yang sama, receiver dapat dibuat dengan input kosong, dihubungkan ke output ODC induk, lalu diisi nomor core kabel masuknya.
- Daftar feeder kabinet bukan bukti sumber setiap core. Sumber yang belum pasti tetap **belum dipetakan**; tidak dibuatkan mapping otomatis.
- ID dan data jaringan lama tidak diganti/di-reset oleh perbaikan. Model C300/C320, format HSGQ/manual, dan tiga laporan lama tetap diuji.
- Status tetap catatan manual; aplikasi tidak mengubah konfigurasi atau membaca status optik OLT secara langsung.

## Pengujian

```bash
npm run build
npm test
npm run test:render       # perlu server demo berjalan; default port 8080
# atau regresi audit saja:
npm run test:audit
```

Hasil verifikasi akhir:

| Kelompok | Hasil |
| --- | --- |
| Build produksi | Lulus |
| Logika jaringan lama | 70 pemeriksaan lulus |
| Logika interface | 20 pemeriksaan lulus |
| API interface / migrasi / restart | 99 permintaan terverifikasi, lulus |
| Model laporan / CSV / PDF | 22 pengujian lulus |
| API CRUD / validasi / peran lama | 117 pemeriksaan lulus |
| Layout runtime Docker | Lulus |
| Interaksi interface dan laporan lama | Seluruh skenario lulus |
| Audit klien sesi/API | 8 skenario lulus |
| Audit keamanan sambungan/API | 15 skenario lulus |
| Audit interaksi UI | 19 skenario lulus |
| Smoke render | 10 rute dan pengalihan halaman admin untuk operator lulus |
| `git diff --check` | Bersih |

Total regresi audit tambahan: **42 skenario**, sudah masuk `npm test`. Uji mutasi inventaris, kredensial/peran fixture, restart/migrasi dan kasus destruktif memakai **database sementara**, bukan database preview.

## Data dan batas verifikasi

- Preview memakai data demo yang tersedia sejak pemulihan lingkungan sebelumnya; audit ini bukan pemulihan inventaris jaringan lama yang tidak tersedia.
- Sebelum restart API, database preview dicadangkan ke `data/backups/fiberops-before-audit-restart-2026-10-19.db` (lokal, diabaikan Git).
- Perbandingan isi 11 tabel jaringan sebelum/sesudah verifikasi akhir dan pemeriksaan foreign key dilakukan untuk memastikan pengujian tidak mengubah inventaris preview. Login/smoke dapat membuat sesi autentikasi sementara.
- UI diuji dengan React + jsdom, API SQLite sungguhan, respons tertunda, dan pembacaan ulang PDF. Belum dilakukan pengujian browser Chromium/ponsel sungguhan, worker/canvas PDF di browser, beban produksi, atau perangkat OLT fisik.
- Peringatan ukuran bundle Vite dan status eksperimental SQLite Node masih ada, tidak membuat pengujian gagal. Optimasi pemuatan awal tetap merupakan pekerjaan performa terpisah.
