# FiberOps Arena

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
5. **Splitter bertingkat (baru)** — pilih rasio **1:2 / 1:4 / 1:8 / 1:16 / 1:32**,
   ditempatkan **di dalam ODC maupun di dalam ODP**. Setiap output splitter bisa
   diarahkan **ke ODP** atau **di-cascade ke splitter lain**, sehingga topologi
   bertingkat seperti **4:8:8** (OLT → SPL 1:4 → SPL 1:8 → ODP dengan SPL 1:8)
   bisa dimodelkan penuh. Aplikasi otomatis membaca rantainya sebagai "Topologi 4:8:8".
6. **Mapping Core** — peta jalur **end-to-end**: dari port feeder OLT →
   core ODC → core ODP → pelanggan, lengkap dengan redaman (dB), daya per titik,
   dan penanda core mana yang sudah/belum tersambung. Satu core hanya boleh
   memiliki satu sambungan (dijaga di sisi server).
7. **Topologi** — halaman dengan **dua tampilan**:
   * **Diagram** — gambar alur jaringan dari kiri ke kanan: OLT → port feeder →
     ODC → splitter (termasuk cascade bertingkat) → ODP → splitter di dalam ODP.
     Garis diberi label (porta feeder, core masuk, out N, dan `C1→C2` untuk
     sambungan core yang diwarnai sesuai standar TIA/EIA-598). Klik simpul untuk
     menyorot seluruh jalurnya, bisa zoom, dan label bisa disembunyikan.
     ODP yang belum dipetakan core ditandai garis putus-putus.
   * **Daftar** — pohon OLT → ODC → ODP yang bisa dibuka-tutup (tampilan lama).
8. **Laporan** — ekspor CSV + manajemen user berbasis peran (admin/operator/user).

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

```bash
npm install
npm run build          # menghasilkan dist/
node server.mjs        # SATU proses melayani API + frontend (port 4500)
```

Setelah di-build, `node server.mjs` membuka `http://server:4500` berisi
aplikasi lengkap — tidak ada server frontend terpisah, dan `node_modules`
tidak dibutuhkan saat runtime. Panduan lengkap (Docker, systemd, backup):
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
| `src/lib/topology.js` | Perhitungan tata letak diagram topologi (murni, bisa diuji via node) |
| `src/components/TopologiDiagram.jsx` | Diagram SVG interaktif OLT → ODC → splitter → ODP |
| `src/pages/Mapping.jsx` | Peta jalur core OLT → ODC → ODP + jalur splitter bertingkat |
| `src/components/SplitterManager.jsx` | Kelola splitter (rasio, input core) & arah tiap output (ODP / cascade) |
| `src/lib/api.js` | Klien fetch + sesi token |
| `src/components/CoreManager.jsx` | Grid core interaktif (dipakai ODC & ODP) |
| `src/pages/*` | Dashboard, OLT, ODC, ODP, Topologi, Laporan, Users |
| `data/fiberops.db` | Database (di-gitignore, di-seed otomatis) |
