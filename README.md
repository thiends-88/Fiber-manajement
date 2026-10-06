# FiberOps Arena

Aplikasi manajemen fiber optik (OLT → ODC → ODP) yang **dibangun dari nol**
untuk lingkungan Arena. Fitur dipelajari dari aplikasi aslinya
(tanpa memakai kode aplikasi lama): manajemen OLT + card + port GPON, ODC/ODC dengan
tipe kabel standar, penugasan core berwarna TIA/EIA-598, topologi, laporan
CSV, dan manajemen user berbasis peran.

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
| `server.mjs` | API HTTP + skema & seed SQLite (tanpa dependensi npm) |
| `src/lib/fiber.js` | Konstanta kabel, warna core TIA/EIA-598, status |
| `src/lib/api.js` | Klien fetch + sesi token |
| `src/components/CoreManager.jsx` | Grid core interaktif (dipakai ODC & ODP) |
| `src/pages/*` | Dashboard, OLT, ODC, ODP, Topologi, Laporan, Users |
| `data/fiberops.db` | Database (di-gitignore, di-seed otomatis) |
