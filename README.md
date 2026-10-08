# Fiber Manajement Core

Aplikasi manajemen fiber optik (OLT → ODC → ODP) yang **dibangun dari nol**
untuk lingkungan Arena. Fitur dipelajari dari aplikasi aslinya
(tanpa memakai kode aplikasi lama): manajemen OLT + card + port GPON, ODC/ODC dengan
tipe kabel standar, penugasan core berwarna TIA/EIA-598, topologi, laporan
CSV, dan manajemen user berbasis peran.

## Fitur inti

1. **OLT** — perangkat, card (slot/tipe), port GPON + status, SFP/serial,
   serta **daya TX/RX (dBm)** per port.
2. **ODC** — induk OLT, tipe kabel, lokasi, dan **port feeder OLT** yang
   menyuplai ODC tersebut — **boleh lebih dari satu port** (satu ODC bisa
   ditarik dari beberapa port feeder). Port feeder wajib milik OLT induk ODC.
3. **ODP** — induk ODC, tipe kabel, lokasi.
4. **Core** — penugasan core per kabel dengan warna standar TIA/EIA-598
   (12 warna per tube), status idle/terpakai/reserved/rusak, pelanggan,
   tujuan, dan **daya optik terukur (dBm)** per core.
5. **Anggaran daya per jalur (power budget)** — otomatis menghitung daya
   sampai ODP: **TX SFP di OLT (dBm) − redaman kabel feeder − redaman splitter
   sepanjang jalur = daya di ujung**. Contoh: TX +7 dBm dengan topologi 4:8:8
   (1:4 + 1:8 + 1:8 = 28,3 dB) → 7 − 28,3 = **−21,3 dBm**.
   Tabel redaman splitter yang dipakai: 1:2 = 3,6 · 1:4 = 7,3 · 1:8 = 10,5 ·
   1:16 = 13,8 · 1:32 = 17,0 dB. Status otomatis dibandingkan sensitivitas GPON
   kelas B+ (−28 dBm): **aman**, **mendekati batas**, atau **gagal**.
   Bisa dilihat di menu **Mapping Core** (tabel per ODP) dan dengan mengklik
   simpul ODP pada **Topologi**.
6. **Splitter bertingkat** — pilih rasio **1:2 / 1:4 / 1:8 / 1:16 / 1:32**,
   ditempatkan **di dalam ODC maupun di dalam ODP**. Setiap output splitter bisa
   diarahkan **ke ODP**, **di-cascade ke splitter lain**, atau **ke ODC anak**.
   Topologi bertingkat seperti **4:8:8** (OLT → SPL 1:4 → SPL 1:8 di dalam ODC →
   ODP dengan SPL 1:8) bisa dimodelkan penuh, dan aplikasi otomatis membaca
   rantainya sebagai "Topologi 4:8:8".
   Data demo memakai persis alur ini: **OLT → ODC-001 [SPL-1 1:4 → SPL-2 1:8] →
   ODP-001/ODP-003 [SPL 1:8]**, plus satu cabang **ODC anak**.
7. **ODC induk / ODC anak** — sebuah output splitter yang berada **di dalam ODC**
   bisa diarahkan ke **ODC lain**, sehingga ODC tujuan menjadi *ODC anak* dari
   ODC sumber (*induks*). ODC anak ditandai badge **"ODC anak"** di halaman ODC
   beserta asal suplainya (splitter & port). Diperbolehkan berlapis
   (anak → cucu). Server menolak arah yang membentuk **lingkaran**
   (mis. ODC anak diarahkan balik ke induknya) dengan pesan
   *"Akan membentuk lingkaran ODC induk/anak"*, dan hanya splitter di dalam ODC
   yang boleh menargetkan ODC. Anggaran daya otomatis menelusuri seluruh rantai
   ODC induk → anak, menjumlahkan redaman feeder tiap ODC dan splitter tiap
   tingkat (contoh demo: ODP-004 lewat ODC-001 → ODC-003 = 29,2 dB).
7. **Mapping Core** — peta jalur **end-to-end**: dari port feeder OLT →
   core ODC → core ODP → pelanggan, lengkap dengan redaman (dB), daya per titik,
   dan penanda core mana yang sudah/belum tersambung. Satu core hanya boleh
   memiliki satu sambungan (dijaga di sisi server).
8. **Topologi** — halaman dengan **dua tampilan**:
   * **Diagram** — gambar alur jaringan dari kiri ke kanan: OLT → port feeder →
     ODC → splitter (termasuk cascade bertingkat dan cabang ke **ODC anak**) →
     ODP → splitter di dalam ODP.
     Garis diberi label (porta feeder, core masuk, out N, dan `C1→C2` untuk
     sambungan core yang diwarnai sesuai standar TIA/EIA-598). Klik simpul untuk
     menyorot seluruh jalurnya, bisa zoom, dan label bisa disembunyikan.
     ODP yang belum dipetakan core ditandai garis putus-putus.
   * **Daftar** — pohon OLT → ODC → ODP yang bisa dibuka-tutup (tampilan lama).
9. **Laporan** — ekspor CSV + manajemen user berbasis peran (admin/operator/user).

**Database sederhana versi Arena:** SQLite bawaan Node (`node:sqlite`) dalam
satu file `data/fiberops.db`. Tidak ada Supabase, tidak ada koneksi keluar.
Hapus file tersebut untuk mereset ke data demo.

## Tampilan (mode + warna)

Tampilan diatur dari **tombol di pojok kanan atas** (tersedia juga di halaman
login). Panel tertutup secara bawaan — hanya berupa ikon kecil — sehingga tidak
mengganggu tampilan aplikasi; klik untuk membuka, klik di luar atau tekan Esc
untuk menutup. Pilihan tersimpan otomatis di browser. Dua pilihan yang bebas
dikombinasikan:

**Mode tampilan**

| Mode | Keterangan |
| --- | --- |
| Terang | putih bersih, cocok untuk ruangan terang / presentasi |
| Gelap (default) | abu gelap, nyaman untuk pemakaian lama |
| Pekat | hitam pekat (hemat daya di layar OLED) |
| Auto | otomatis mengikuti pengaturan terang/gelap sistem operasi |

**Warna aksen:** Aurora (ungu+cyan), Samudra (biru), Zamrud (hijau),
Senja (merah muda+jingga), Neon (lime+magenta).

Menambah pilihan cukup: tambahkan entri di `src/lib/theme.js` dan blok CSS
`html[data-mode="..."]` / `html[data-accent="..."]` di `src/styles.css`.

## Menjalankan (pengembangan)

```bash
npm install            # sekali saja
node server.mjs        # API di port 4500
npm run dev            # frontend di port 8080 (proxy /api → 4500)
```

## Produksi / deploy (mis. Proxmox)

Syarat: **Node.js 22.5+** (database memakai `node:sqlite` bawaan Node).

```bash
npm install
npm run build          # menghasilkan dist/
node server.mjs        # SATU proses melayani API + frontend (port 4500)
```

Setelah di-build, `node server.mjs` membuka `http://server:4500` berisi
aplikasi lengkap — tidak ada server frontend terpisah, dan `node_modules`
tidak dibutuhkan saat runtime.

> **Kode ada di cabang `arena/34102c90-fiber-manajement`** (belum di-merge ke
> `main`), jadi saat clone di server gunakan:
> `git clone --depth 1 --branch arena/34102c90-fiber-manajement https://github.com/thiends-88/Fiber-manajement.git`

## Uji otomatis halaman (anti "halaman blank")

Uji ini merender **semua halaman** memakai jsdom + data sungguhan dari server,
lalu memastikan data demo ikut tampil (mis. `ODC-001`, badge `ODC anak`,
`Anggaran Daya`, `SPL-1`) dan tidak ada pesan error render:

```bash
node server.mjs            # server harus jalan (data demo)
npm run test:render        # hasil: SEMUA HALAMAN TAMPIL NORMAL
```

Kalau ada halaman yang kosong/error (mis. `X is not defined`), uji ini GAGAL
dan menyebutkan rutenya. Port server bisa diganti: `ARENA_API_PORT=3000 npm run test:render`.

Panduan **instalasi lengkap di Proxmox** (buat VM, install Node, service systemd,
backup, reverse proxy, troubleshooting):
lihat **[DEPLOY-PROXMOX.md](DEPLOY-PROXMOX.md)**. Tersedia juga `Dockerfile`.

## Login demo

| Peran    | Email                 | Password    |
| -------- | --------------------- | ----------- |
| admin    | `admin@arena.test`    | `Arena123!` |
| operator | `operator@arena.test` | `Arena123!` |

- **admin**: kelola data + kelola user
- **operator**: kelola data jaringan
- **user**: hanya baca

## Struktur

| File | Isi |
| --- | --- |
| `server.mjs` | API HTTP + skema & seed SQLite (tanpa dependensi npm), termasuk migrasi otomatis DB lama |
| `src/lib/fiber.js` | Konstanta kabel, warna core TIA/EIA-598, status |
| `src/lib/budget.js` | Perhitungan anggaran daya per jalur (murni, bisa diuji via node) |
| `src/lib/topology.js` | Perhitungan tata letak diagram topologi (murni, bisa diuji via node) |
| `src/components/TopologiDiagram.jsx` | Diagram SVG interaktif OLT → ODC → splitter → ODP |
| `src/pages/Mapping.jsx` | Peta jalur core OLT → ODC → ODP + jalur splitter bertingkat |
| `src/components/SplitterManager.jsx` | Kelola splitter (rasio, input core) & arah tiap output (ODP / cascade / ODC anak) |
| `src/lib/api.js` | Klien fetch + sesi token |
| `src/components/CoreManager.jsx` | Grid core interaktif (dipakai ODC & ODP) |
| `src/pages/*` | Dashboard, OLT, ODC, ODP, Topologi, Laporan, Users |
| `data/fiberops.db` | Database (di-gitignore, di-seed otomatis) |
