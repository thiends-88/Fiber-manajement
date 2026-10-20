# Panduan interface OLT untuk pencatatan di lapangan

Fitur ini menjawab dua pertanyaan:

- **Dari OLT:** interface `1/1/1` menyuplai ODC, splitter, dan ODP mana saja?
- **Dari ODP:** sambungan ini berasal dari interface OLT yang mana?

Ini adalah **dokumentasi sambungan fisik**, bukan konfigurasi atau monitoring
langsung OLT. Aplikasi tidak menjalankan perintah SSH/SNMP, mengubah perangkat,
atau mendeteksi status port otomatis. Verifikasi label dan sambungan di lapangan.

## 1. Catat interface pada Manajemen OLT

### ZTE C300 dan C320

1. Tambahkan/pilih OLT dengan tipe yang sesuai.
2. Gunakan format **Shelf / slot / port**.
3. Tambah card sesuai posisi fisiknya: **shelf**, **slot**, tipe, dan jumlah port.
   Kapasitas mengikuti card terpasang; jangan menganggap setiap card berisi 8 port.
4. Klik kotak port untuk mencatat status, model/serial SFP, dan catatan.

Contoh:

| Shelf | Slot/card | Port | Tampilan | Nama CLI ZTE |
| --- | --- | --- | --- | --- |
| 1 | 1 | 1 | `GPON 1/1/1` | `gpon-olt_1/1/1` |
| 1 | 2 | 1 | `GPON 1/2/1` | `gpon-olt_1/2/1` |

Nomor shelf/slot dapat disesuaikan; aplikasi tidak menebak slot mana yang berisi
card GPON berdasarkan model chassis. ID port berbeda untuk setiap OLT, sehingga
`OLT-A / 1/1/1` tidak tertukar dengan `OLT-B / 1/1/1`.

### HSGQ dan perangkat fixed-port

- Pilih **Port PON langsung**, lalu isi jumlah port bawaan sesuai perangkat.
- Klik `PON 1`, `PON 2`, dst. untuk mencatat port. **Tidak perlu menambah card.**
- Jika nama pada model HSGQ/perangkat lain berbeda, pilih **Nama interface manual**
  saat membuat OLT dan isi label persis seperti perangkat, misalnya `EPON0/1`.
  Label contoh ini bukan aturan universal HSGQ.

Format tidak dapat diganti selama card/interface masih tercatat. Ini mencegah
perubahan penamaan massal yang tidak disengaja. Untuk mengganti perangkat dengan
struktur penomoran berbeda, catat OLT baru dan pindahkan sambungan secara terencana.
Jumlah port fixed-port masih dapat ditambah; tidak dapat dikurangi melewati port
tertinggi yang sudah tercatat.

### Ringkasan Perangkat OLT di Dashboard

Buka **Dashboard → Perangkat OLT**. Setiap nama/model OLT memiliki rincian yang
bisa dilipat: jumlah tiap tipe card terpasang, shelf/slot dan tabel per card.

| Angka | Cara membaca |
| --- | --- |
| **Card terpasang** | Card fisik yang benar-benar dicatat, bukan jumlah slot chassis. Port bawaan HSGQ/profil PON/manual tidak dihitung sebagai card. |
| **Kapasitas** | Jumlah port yang dikonfigurasi pada card atau port bawaan OLT. Tidak ditebak dari nama model atau tipe card. |
| **Tercatat** | Interface yang sudah memiliki catatan port di Manajemen OLT. Kapasitas 16 dengan 2 port tercatat tetap ditampilkan sebagai 16 dan 2, bukan dianggap ada 14 port idle. |
| **Aktif** | Port dengan status **Aktif** yang Anda isi manual pada Manajemen OLT. Bukan hasil pembacaan OLT. |
| **Terpakai** | Port dengan pemetaan eksplisit **interface → core feeder** yang sesuai OLT induk, terpilih sebagai feeder ODC, dan tidak memiliki konflik input langsung. Dihitung sekali per port, bukan per ODC, ODP, atau output splitter. |
| **Feeder belum dipetakan** | Port yang sudah dipilih sebagai feeder, tetapi belum memiliki mapping yang valid. Periksa di Mapping Core; data lama yang konflik tidak ditebak sumbernya. |

**Aktif dan Terpakai bukan dua kelompok yang saling terpisah dan tidak boleh
dijumlahkan.** Port bisa berstatus aktif tetapi belum dipetakan; sebaliknya,
mapping tetap tercatat walaupun status manual port nonaktif/reserved/rusak.
Terpakai bukan jumlah ONT/pelanggan atau bukti sinyal sedang menyala.

Nama tipe card mengikuti inventaris apa adanya. Card tanpa catatan port tetap
muncul dengan hitungan nol; OLT tanpa card tidak diisi card contoh. Untuk OLT
fixed-port, baris **Port bawaan OLT** tidak menampilkan shelf/slot internal fiktif.
Klik **Rincian OLT & interface** untuk membuka perangkat yang benar berdasarkan
ID-nya. Setelah mengubah inventaris/mapping, kembali ke Dashboard atau klik
**Muat ulang**. Pembacaan dashboard hanya membaca data, tidak mengubah inventaris.

## 2. Pilih interface feeder pada ODC

Pada **Manajemen ODC → Edit ODC**, pilih interface yang benar-benar masuk ke
kabinet. Lebih dari satu boleh dipilih, tetapi harus milik OLT induk ODC.

**Daftar ini bukan pemetaan core.** Memilih dua interface pada satu ODC tidak
berarti semua ODP di sana dilayani oleh kedua interface tersebut.

Jika kabinet menerima kabel dari **ODC induk**, gunakan output splitter induk →
ODC tujuan → **splitter penerima tertentu**. Jangan membuat feeder OLT langsung
hanya karena ODC anak memiliki induk OLT secara administratif.

## 3. Petakan interface ke core feeder

Buka **Mapping Core**, pilih ODC, kemudian bagian **Interface OLT → Core Feeder**.
Bagian yang sama juga tersedia saat membuka ODC pada Manajemen ODC.

1. Klik **Petakan interface** atau **Atur** pada core yang belum dipetakan.
2. Pilih nomor core pada kabel feeder langsung OLT → ODC.
3. Pilih interface sumber dari daftar feeder ODC.
4. Isi catatan bila perlu: label kabel, ODF, tray, patchcord, atau closure.
5. Simpan.

Contoh dua sumber yang melewati kabinet sama:

```text
OLT-PUSAT / GPON 1/1/1 → ODC-001 / core 1 Biru → SPL-A → ODP-001/ODP-002
OLT-PUSAT / GPON 1/2/1 → ODC-001 / core 2 Jingga → SPL-B → ODP-003
```

Satu port fisik memiliki **satu feeder langsung**. Jika sinyal bercabang, catat
percabangannya melalui output splitter; jangan memetakan port yang sama sebagai
beberapa feeder langsung yang berbeda. Satu core feeder juga tidak boleh sekaligus
menjadi input dua splitter langsung atau menjadi kabel langsung dan input splitter.
Aplikasi menandai input ganda sebagai perlu diperiksa, bukan menganggap sumbernya
sudah terkonfirmasi.

### Cakupan pencatatan kabel

Feeder langsung masih mengikuti struktur kabel yang sudah ada: **nomor core unik
pada kabel feeder ODC tersebut**. Dua kabel feeder langsung berbeda yang sama-sama
memakai core 1 di satu ODC belum memiliki identitas kabel terpisah dalam model ini.
Jangan menyatukannya atau mengganti nomor core secara fiktif; pemodelan banyak kabel
feeder per kabinet memerlukan pengembangan tersendiri.

Sebaliknya, **jalur dari output splitter ke ODC anak** sudah dibedakan berdasarkan
splitter penerima. Nomor core/warna yang berulang pada jalur masuk tersebut tidak
menyatukan dua sumber. Interface asal diwarisi dari jalur induk yang benar.

## 4. Catat sambungan hilir

- **Lewat splitter:** di Manajemen ODC, isi core masuk splitter pertama, lalu
  arahkan setiap output ke ODP, cascade splitter, atau splitter penerima ODC anak.
- **Kabel langsung:** di Mapping Core, gunakan **Tambah Sambungan** untuk mencatat
  core ODC → ODP dan core tujuan. Jangan menduplikasi core yang masuk splitter.
- Splitter cascade mengikuti sumber induk, bukan diberi feeder baru.

Jika input core splitter belum diisi, jalur tetap terlihat dengan penanda
**Core masuk belum diisi**. Lengkapi input splitter sebelum memetakan interface.

## 5. Telusuri dan periksa kembali

- **Alur Core:** pilih OLT → interface. Hanya jalur dan ODP pada sumber tersebut
  yang tampil, termasuk cabang ke ODC anak.
- **Diagram:** filter yang sama berlaku. Klik simpul untuk melihat sumber dan
  **Alur core sampai ke sini**.
- **Manajemen ODP:** klik ODP, lalu baca **Asal interface OLT**. Jika memiliki
  beberapa jalur masuk, semuanya ditampilkan terpisah.
- Klik nama interface pada tabel OLT/mapping atau tautan dari detail ODP untuk
  membuka cabangnya. URL menyimpan pilihan OLT/interface sehingga bisa dibagikan.
- Pencarian mempertahankan jalur lengkap, tidak hanya menampilkan nama ODP tanpa
  asalnya. Status port yang tampil adalah **status tercatat manual**.

ODC yang sama dapat muncul beberapa kali di diagram: setiap kotak mewakili
core/jalur masuk yang berbeda. Ini disengaja agar garis port A tidak tersambung
secara visual ke ODP milik port B.

### Batas penelusuran di dalam ODP

Tujuan utama penelusuran adalah sampai perangkat ODP. Daftar splitter di dalam
ODP adalah inventaris, bukan bukti bahwa setiap jalur masuk menyuplai semuanya.
Jika core tujuan ODP diketahui (pada sambungan kabel langsung), diagram hanya
melanjutkan ke splitter dengan input core yang cocok. Sambungan output splitter
ke ODP yang belum mencatat core masuk berhenti di ODP; aplikasi tidak meneruskan
sumber secara sembarang ke seluruh splitter internal atau ODP berikutnya.

## 6. Membaca dan mengekspor laporan per interface

1. Buka **Laporan → Per Interface** (tab bawaan menu Laporan).
2. Pilih **OLT sumber**, lalu **Interface / sumber**, misalnya `GPON 1/1/1`.
   Pilihan interface menyertakan nama OLT; nomor yang sama pada OLT lain tetap
   dipisahkan berdasarkan ID port.
3. Baca ringkasan **interface, ODC unik, ODP unik**, dan **kelompok belum dipetakan**.
   Buka panel interface untuk melihat ODC/core feeder, **warna/tube**, urutan
   splitter beserta outputnya, receiver **ODC anak**, hingga ODP dan lokasinya.
   Jika satu interface dipilih, rincian terbuka otomatis.
4. Kolom kondisi membedakan sambungan ke ODP yang sudah dicatat, output yang
   belum diarahkan, receiver ODC yang belum dipilih, serta feeder tanpa hilir.
   Status Aktif/Non-aktif/Reserved/Rusak adalah **catatan port**, bukan hasil
   pembacaan langsung perangkat.
5. Gunakan pencarian untuk menemukan interface dari nama ODC/ODP, kode CLI,
   core, lokasi tujuan, atau catatan sambungan. **Pencarian menyeleksi interface
   beserta seluruh jalurnya**, bukan menghilangkan cabang lain pada interface
   yang sama. Hitungan ODP tidak berlipat karena beberapa jalur mencapai ODP
   yang sama, termasuk ketika menjumlahkan hasil beberapa interface.
6. Klik **CSV**, **Lihat PDF**, atau **Unduh PDF**. Semua memakai **filter aktif**
   yang sama, termasuk rincian panel yang masih tertutup. CSV berisi satu baris
   per rute/kondisi dan kolom sumber terpisah. PDF dikelompokkan per interface,
   membungkus jalur panjang, dan mengulang konteks interface/filter/nomor halaman.
   Unduhan satu interface menyertakan nama OLT dan interface pada nama berkas.
7. Gunakan **Muat ulang** setelah ada perubahan sambungan dari halaman/sesi lain,
   atau **Reset filter** untuk kembali melihat semua sumber. Jika muat data
   gagal, hasil/ekspor dinonaktifkan sampai data lengkap berhasil dimuat kembali.

**Belum dipetakan / perlu diperiksa** menampilkan jalur tanpa sumber pasti
terpisah dari interface terkonfirmasi. Nama OLT pada kelompok ini hanya induk
administratif ODC. Input ganda atau mapping yang tidak valid tidak dianggap
sebagai sumber interface, dan diberi peringatan pada port yang sempat tercatat.
Port tanpa mapping tetap dapat dilaporkan dengan nol ODC/ODP. ODP tanpa jalur
sambungan yang dapat ditelusuri tidak ditempelkan ke interface mana pun; periksa
inventarisnya di **Power ODP** dan lengkapi Mapping Core.

Laporan **Alur Core ODC**, **Power ODP**, dan **Rekap Core** tetap tersedia.
Laporan tidak mengubah database, baik saat membaca, memfilter, maupun mengekspor.
Peran user/baca saja dapat mengakses dan mengekspor laporan.

## Data lama dan perubahan sambungan

- Migrasi menambahkan kolom/tabel tanpa menghapus OLT, card, port, core, atau jalur
  lama. **Tidak ada pemilihan interface asal otomatis**, bahkan jika daftar feeder
  hanya berisi satu port.
- Shelf pada card lama dimulai dari **1**. Periksa dan sesuaikan dengan perangkat.
- Jalur yang belum memiliki pemetaan ditandai **Interface asal belum dipetakan**;
  tersedia filter **Belum dipetakan** untuk melengkapinya bertahap.
- Mengubah shelf/slot/nomor port memperbarui namanya pada jalur yang sama; referensi
  tetap berdasarkan ID port. UI meminta konfirmasi. Lakukan hanya bila sesuai fisik.
- **Lepaskan mapping** hanya menghapus hubungan interface → core. Sambungan
  splitter/ODP tetap disimpan dan asalnya kembali ditandai belum dipetakan.
- Port/card yang masih dipetakan tidak bisa dihapus langsung. Begitu juga feeder
  ODC tidak bisa dibuang/dipindahkan ke OLT lain selama mapping-nya masih digunakan.
- Admin dan operator dapat mengubah mapping. Peran user hanya dapat membaca.
- Backup database sebelum menerapkan pembaruan ke server lapangan.

## Pengujian pengembang

```bash
npm run build
npm test                     # logika, API lama/baru, migrasi, runtime, interaksi UI
npm run test:interfaces       # penamaan, pemisahan sumber, API, restart & migrasi
npm run test:interfaces:ui    # UI interface/laporan + ekspor, API SQLite sementara
npm run test:laporan          # isolasi sumber, statistik, CSV aman, PDF dibaca ulang
npm run test:dashboard        # hitungan per OLT/card, status/mapping, port bawaan, UI/refresh
npm run test:render           # smoke test fixture demo; server berdata demo harus aktif
```

Uji interface dan UI memakai database sementara, bukan database pengguna.
