# Fiber Manajement Core

Aplikasi manajemen fiber optik (OLT → ODC → ODP) yang **dibangun dari nol**
untuk lingkungan Arena. Fitur dipelajari dari aplikasi aslinya
(tanpa memakai kode aplikasi lama): manajemen OLT + card + port GPON, ODC/ODC dengan
tipe kabel standar, penugasan core berwarna TIA/EIA-598, laporan CSV, dan
manajemen user berbasis peran.

Fokusnya satu: **memperlihatkan alur core kabel dari OLT → ODC → ODP dengan
jelas** — port GPON mana, core warna apa, lewat splitter berapa tingkat, sampai
ke ODP mana. Aplikasi ini **tidak menghitung redaman/daya optik**; yang
ditampilkan hanya alur dan nama perangkat, supaya cepat dibaca teknisi di
lapangan.

## Fitur inti

1. **OLT** — perangkat, card (slot/tipe), port GPON + status, SFP/serial.
2. **ODC** — induk OLT, tipe kabel, lokasi, dan **port feeder OLT** yang
   menyuplai ODC tersebut — **boleh lebih dari satu port** (satu ODC bisa
   ditarik dari beberapa port feeder). Port feeder wajib milik OLT induk ODC.
3. **ODP** — induk ODC, tipe kabel, lokasi.
4. **Core** — penugasan core per kabel dengan warna standar TIA/EIA-598
   (12 warna per tube), status idle/terpakai/reserved/rusak, pelanggan,
   dan tujuan per core.
5. **Alur Core (halaman utama)** — begitu masuk, teknisi langsung melihat
   pohon jalur per core, urut seperti kenyataan di lapangan:

   ```
   OLT-PST-01 → ODC-001 (kabel 24 core)
     └─ Core 1 · Biru · Tube 1
         └─ SPL-1 (Splitter 1:4, input core 1)
             ├─ via out 1 → SPL-2 (Splitter 1:8)
             │     ├─ out 1 → ODP-001  (Splitter di dalam ODP: SPL-ODP1 1:8)
             │     └─ out 2 → ODP-003
             └─ 2 output belum diarahkan
   ```

   Contoh di atas berarti **1 port GPON** dipecah 1:4 lalu 1:8 di dalam ODC, dan
   tiap ODP memecah lagi 1:8 — cukup untuk menggambarkan kapasitas satu port
   tanpa perlu angka redaman. Sambungan **kabel langsung** (1 core ODC → 1 ODP
   tanpa splitter) dipisahkan di bawah pohon supaya tidak tercampur.
6. **Splitter bertingkat** — pilih rasio **1:2 / 1:4 / 1:8 / 1:16 / 1:32**,
   ditempatkan **di dalam ODC maupun di dalam ODP**. Setiap output splitter bisa
   diarahkan **ke ODP**, **di-cascade ke splitter lain**, atau **ke ODC anak**.
   Topologi splitter bertingkat (mis. OLT → SPL 1:4 → SPL 1:8 di dalam ODC →
   ODP dengan SPL 1:8) bisa dimodelkan penuh, dan aplikasi otomatis membaca
   rantainya sesuai rasio splitter yang terpasang.
   Data demo memakai persis alur ini: **OLT → ODC-001 [SPL-1 1:4 → SPL-2 1:8] →
   ODP-001/ODP-003 [SPL 1:8]**, plus satu cabang **ODC anak**.
7. **ODC induk / ODC anak** — sebuah output splitter yang berada **di dalam ODC**
   bisa diarahkan ke **ODC lain**, sehingga ODC tujuan menjadi *ODC anak* dari
   ODC sumber (*induks*). ODC anak ditandai badge **"ODC anak"** di halaman ODC
   beserta asal suplainya (splitter & port). Diperbolehkan berlapis
   (anak → cucu). Server menolak arah yang membentuk **lingkaran**
   (mis. ODC anak diarahkan balik ke induknya) dengan pesan
   *"Akan membentuk lingkaran ODC induk/anak"*, dan hanya splitter di dalam ODC
   yang boleh menargetkan ODC. Halaman **Alur Core** menelusuri seluruh rantai
   ODC induk → anak sampai ke ODP-nya.
7. **Mapping Core** — tempat **mencatat** sambungan: core ODC mana tersambung
   ke ODP mana, lengkap dengan penanda core yang sudah/belum tersambung. Satu
   core hanya boleh memiliki satu sambungan (dijaga di sisi server).
   **Peta Jalur Core** menampilkan **pohon jalur per core ODC**: 1 core masuk
   splitter lalu bercabang — output **→ ODP**, **→ cascade splitter lain**,
   atau **→ ODC anak** (lanjut ke splitter di dalamnya); port output yang belum
   diarahkan **diringkas** (tidak digambar satu per satu). **Sambungan kabel
   langsung** (1 core → 1 ODP tanpa splitter) dipisahkan dan diberi label
   tersendiri.
8. **Alur Core / Diagram** — halaman utama dengan **dua tampilan**:
   * **Alur Core** (bawaan) — pohon jalur per core seperti contoh di poin 5.
   * **Diagram** — gambar alur jaringan dari kiri ke kanan: OLT → port feeder →
     ODC → splitter (termasuk cascade bertingkat dan cabang ke **ODC anak**) →
     ODP → splitter di dalam ODP.
     Garis diberi label (porta feeder, core masuk, out N, dan `C1→C2` untuk
     sambungan core yang diwarnai sesuai standar TIA/EIA-598). Klik simpul untuk
     menyorot seluruh jalurnya, bisa zoom, dan label bisa disembunyikan.
     ODP yang belum dipetakan core ditandai garis putus-putus.
     **Warna core mengalir**: garis feed, cascade, dan output diwarnai sesuai core kabel ODC asal (TIA/EIA-598); titik warna di kanan-bawah ODP menunjukkan core yang masuk, dan Mapping menampilkan chip "core N · Warna" di tiap ODP.
     Klik simpul untuk menyorot jalurnya dan melihat **"Alur core sampai ke
     sini"** — rantai penuh dari OLT ke simpul itu (mis. `OLT-PST-01 → ODC-001 →
     SPL-1 → SPL-2 → ODP-001`), jawaban cepat untuk "core ini datang dari mana?".
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

> Kode terbaru sudah ada di **`main`** (cabang lama
> `arena/34102c90-fiber-manajement` sudah di-merge). Untuk clone baru di
> server:
> `git clone --depth 1 https://github.com/thiends-88/Fiber-manajement.git`
> Untuk memperbarui server yang sudah ada: `git pull && npm install && npm run build`.

## Uji otomatis halaman (anti "halaman blank")

Uji ini merender **semua halaman** memakai jsdom + data sungguhan dari server,
lalu memastikan data demo ikut tampil (mis. `Alur Core`, `SPL-1`, `ODC-001`,
badge `ODC anak`, `Sambungan Kabel Langsung`) dan tidak ada pesan error render:

```bash
node server.mjs            # server harus jalan (data demo)
npm run test:render        # hasil: SEMUA HALAMAN TAMPIL NORMAL
```

Kalau ada halaman yang kosong/error (mis. `X is not defined`), uji ini GAGAL
dan menyebutkan rutenya. Port server bisa diganti: `ARENA_API_PORT=3000 npm run test:render`.

## Uji otomatis lainnya (sebelum masuk Proxmox)

```bash
npm test              # logika + API + tata letak runtime (tidak butuh server jalan)
npm run test:logic    # topologi, alur core, data kabel, peta jalur core (murni, 45 pemeriksaan)
npm run test:api      # login, hak akses, CRUD semua entitas, penjaga validasi (76 pemeriksaan)
npm run test:layout   # server tetap jalan hanya dengan file yang disalin Dockerfile
npm run test:render   # semua halaman ter-render (butuh server jalan)
```

Yang diperiksa `npm run test:api`: login/logout & token, hak akses per peran
(admin/operator/user), CRUD OLT–kartu–port, ODC + port feeder banyak input, ODP,
splitter (rasio sah, tempat di ODC/ODP, cascade, output → ODC anak, cegah
lingkaran), mapping core (core ganda → 409), manajemen user, dashboard/laporan,
input rusak tidak membuat server mati, serta penjaga bahwa **API tidak lagi
mengirim field redaman/daya** (`tx_power`, `rx_power`, `power_dbm`,
`feeder_loss_db`, `loss_db`).

Panduan **instalasi lengkap di Proxmox** — jalur utama **LXC Ubuntu 24.04**
(buat container, IP statis via netplan, install Node 22.5+, service systemd,
backup, reverse proxy, troubleshooting), plus catatan kalau pakai VM Debian 12:
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
| `src/lib/topology.js` | Tata letak diagram + `buildUpstreamChains()` (alur core ke hulu) — murni, bisa diuji via node |
| `src/components/JalurCore.jsx` | Komponen gambar alur core (chip warna core, pohon jalur) — dipakai Alur Core & Mapping |
| `src/lib/jalur-core.js` | Pohon jalur per core ODC: 1 core → splitter → ODP / ODC anak (murni, bisa diuji via node) |
| `src/components/TopologiDiagram.jsx` | Diagram SVG interaktif OLT → ODC → splitter → ODP |
| `src/pages/Mapping.jsx` | Catat sambungan core ODC → ODP (pohon splitter + sambungan kabel langsung) |
| `src/pages/Topologi.jsx` | **Halaman utama "Alur Core"**: pohon jalur per core + tampilan Diagram |
| `src/components/SplitterManager.jsx` | Kelola splitter (rasio, input core) & arah tiap output (ODP / cascade / ODC anak) |
| `src/lib/api.js` | Klien fetch + sesi token |
| `src/components/CoreManager.jsx` | Grid core interaktif (dipakai ODC & ODP) |
| `src/pages/*` | Alur Core (halaman utama), Dashboard, OLT, ODC, ODP, Mapping Core, Laporan, Users |
| `data/fiberops.db` | Database (di-gitignore, di-seed otomatis) |
