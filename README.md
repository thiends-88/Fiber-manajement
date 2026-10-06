# FiberOps Arena

Aplikasi manajemen fiber optik (OLT → ODC → ODP) yang **dibangun dari nol**
untuk lingkungan Arena. Fitur dipelajari dari aplikasi aslinya
(tanpa memakai kode aplikasi lama): manajemen OLT + card + port GPON, ODC/ODC dengan
tipe kabel standar, penugasan core berwarna TIA/EIA-598, topologi, laporan
CSV, dan manajemen user berbasis peran.

## Fitur inti

1. **OLT** — perangkat, card (slot/tipe), port GPON + status, SFP/serial,
   serta **daya TX/RX (dBm)** per port.
2. **ODC** — induk OLT, tipe kabel, lokasi, **sumber power** (PLN/baterai/solar),
   dan **port feeder OLT** yang menyuplai ODC tersebut.
3. **ODP** — induk ODC, tipe kabel, lokasi, **sumber power**.
4. **Core** — penugasan core per kabel dengan warna standar TIA/EIA-598
   (12 warna per tube), status idle/terpakai/reserved/rusak, pelanggan,
   tujuan, dan **daya optik terukur (dBm)** per core.
5. **Mapping Core (baru)** — peta jalur **end-to-end**: dari port feeder OLT →
   core ODC → core ODP → pelanggan, lengkap dengan redaman (dB), daya per titik,
   dan penanda core mana yang sudah/belum tersambung. Satu core hanya boleh
   memiliki satu sambungan (dijaga di sisi server).
6. **Topologi** — struktur pohon OLT → ODC → ODP dengan info feeder, power,
   dan pasangan core yang tersambung.
7. **Laporan** — ekspor CSV + manajemen user berbasis peran (admin/operator/user).

**Database sederhana versi Arena:** SQLite bawaan Node (`node:sqlite`) dalam
satu file `data/fiberops.db`. Tidak ada Supabase, tidak ada koneksi keluar.
Hapus file tersebut untuk mereset ke data demo.

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
| `src/lib/fiber.js` | Konstanta kabel, warna core TIA/EIA-598, sumber power, status |
| `src/pages/Mapping.jsx` | Peta jalur core OLT → ODC → ODP + editor sambungan core |
| `src/lib/api.js` | Klien fetch + sesi token |
| `src/components/CoreManager.jsx` | Grid core interaktif (dipakai ODC & ODP) |
| `src/pages/*` | Dashboard, OLT, ODC, ODP, Topologi, Laporan, Users |
| `data/fiberops.db` | Database (di-gitignore, di-seed otomatis) |
