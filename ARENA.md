# FiberOps — Versi Arena

Versi aplikasi yang bisa berjalan **mandiri di live preview Arena**, tanpa
koneksi ke Lovable Cloud / Supabase. Backend Supabase digantikan oleh mock
server lokal yang mengimplementasikan subset API yang dipakai aplikasi ini
(GoTrue auth + PostgREST + RPC `has_role`), lengkap dengan data demo.

> Kode fitur aplikasi (OLT, ODC, ODP, core assignment, topologi, laporan,
> manajemen user) **tidak diubah** — hanya lapisan koneksinya yang dialihkan.

## Menjalankan

```bash
# Terminal 1 — backend mock (port 54321)
node arena/mock-supabase.mjs

# Terminal 2 — aplikasi
npm run dev
```

Lalu buka URL dev server. Login demo:

| Akun     | Email               | Password   | Peran    |
| -------- | ------------------- | ---------- | -------- |
| Admin    | `admin@arena.test`  | `Arena123!`| admin    |
| Operator | `operator@arena.test` | `Arena123!`| operator |

## Cara kerja

- `arena/mock-supabase.mjs` — server Node murni (tanpa dependensi):
  - `POST /auth/v1/token` (password & refresh), `GET /auth/v1/user`,
    `POST /auth/v1/logout`, `POST /auth/v1/signup`,
    `POST|PUT /auth/v1/admin/users` (service role)
  - `GET|HEAD|POST|PATCH|DELETE /rest/v1/<table>` — filter `eq/neq/is/in/
    gt/gte/lt/lte/like`, `order`, `limit/offset`, `Prefer:
    return=representation|minimal`, upsert `resolution=merge-duplicates`,
    hitung `count=exact` via `Content-Range`, dan `.single()` lewat
    `Accept: application/vnd.pgrst.object+json`
  - `POST /rest/v1/rpc/has_role`
- Data disimpan di `arena/db.json` (di-seed otomatis saat pertama dijalankan;
  sudah masuk `.gitignore`). Hapus file itu untuk reset ke data demo.
- `.env` menyalakan `VITE_ARENA_MODE=true` sehingga
  `src/integrations/supabase/client.ts` memakai URL asal yang sama; Vite dev
  server mem-proxy `/auth/v1` dan `/rest/v1` ke mock (lihat `vite.config.ts`).
- Server function (manajemen user) tetap berjalan lewat middleware
  `requireSupabaseAuth` karena mock menerbitkan JWT palsu 3-segmen dan
  `supabase.auth.getClaims()` hanya melakukan decode sisi klien.

## Uji cepat (self-test)

```bash
# Jalankan saat mock server aktif — memverifikasi auth, query, upsert,
# rpc, count, dan alur server function memakai @supabase/supabase-js asli.
node arena/e2e-check.mjs
```

## Kembali ke Supabase asli

Di `.env`: set `VITE_ARENA_MODE=false` dan kembalikan `SUPABASE_URL` /
`VITE_SUPABASE_URL` ke URL project Supabase Anda. Tidak ada perubahan kode
lain yang diperlukan.
