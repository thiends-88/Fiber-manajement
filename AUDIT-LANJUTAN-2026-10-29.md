# Audit lanjutan aplikasi — 29 Oktober 2026

## Kesimpulan dan cakupan

**Temuan yang berhasil direproduksi telah diperbaiki dan tes regresinya lulus. Ini bukan jaminan bebas seluruh bug atau sertifikasi keamanan produksi.**

Audit source pada branch `arena/126762c1-fiber-manajement`, dengan pembanding `37df297`, mencakup login/peran, CRUD API, integritas simpan, dashboard, pencatatan OLT/card/interface, ODC/ODP, mapping, cascade/receiver, penelusuran, laporan PDF/CSV, dialog, serta helper update native. Perbaikan diajukan melalui **[PR #9](https://github.com/thiends-88/Fiber-manajement/pull/9)**. Audit ini tidak melakukan merge/deploy dan tidak mengakses Proxmox, database produksi, atau perangkat OLT fisik.

Build dan suite semula lulus, tetapi tes tambahan mengungkap masalah di bawah. Karena itu kelulusan suite semula tidak dipakai sebagai bukti bahwa tidak ada bug lain.

## Temuan terverifikasi dan perbaikan

| Area | Masalah yang direproduksi | Perbaikan |
| --- | --- | --- |
| Otorisasi | Request dengan body belum selesai masih dapat menulis setelah akun dihapus, logout, atau role diturunkan. Hak admin lama juga masih dapat menyelesaikan pembuatan user. | Tolak kredensial/hak yang tidak sah sejak awal; setelah body lengkap, baca ulang sesi dan role. Pemeriksaan record/validasi/mutasi dilanjutkan tanpa jeda `await` lain. |
| PATCH parsial | Snapshot card/output dapat dibaca sebelum body tiba: PATCH catatan menimpa label peer yang tidak dikirim dalam body. Record yang dihapus saat upload dapat menghasilkan 200 kosong. | Buffer body sebelum lookup record. PATCH memakai record terbaru pada saat pemrosesan, mempertahankan field yang tidak dikirim, dan mengembalikan 404 bila record sudah hilang. |
| Integritas simpan | Kegagalan SQL pada langkah lanjutan meninggalkan ODC tanpa feeder, ODP/splitter/output parsial, metadata/rasio tidak sesuai, atau referensi cascade yang hilang meskipun API melaporkan gagal. | Transaksi SQLite untuk satu operasi logis multi-tabel: create/edit OLT port bawaan, create/edit ODC+feeder, create ODP+splitter 1:8, create/edit/delete splitter, dan perubahan arah output+cascade. Error membatalkan keseluruhan mutasi tersebut. |
| Dependensi | DOMPurify 3.4.16, dependency transitif jsPDF, terkena tiga advisori yang terdaftar pada audit npm saat pemeriksaan. | Pembaruan terarah lockfile ke **3.4.17**, tanpa upgrade mayor massal. Tes memeriksa detached parent/sibling pada lima hook, ekspresi template di shadow root, dan SVG XHTML. |
| Dialog simpan | Form ODP/user masih dapat diedit saat request tertunda; perubahan tersebut tidak masuk payload yang sudah dikirim dan hilang ketika dialog ditutup sesudah respons. Beberapa form lain belum mengunci seluruh field. | State `busy` pada modal bersama mengunci semua kontrol, tombol tutup, Escape dan backdrop. Berlaku pada form OLT/card/port, ODC/ODP, mapping interface/kabel, core, splitter/output dan user. Error membuka kunci kembali dan mempertahankan isian untuk retry. Nama tombol ikon edit/hapus ODP/user juga dilengkapi. |

### Batas interpretasi keamanan dan concurrency

- Advisori DOMPurify memerlukan konfigurasi/input tertentu, seperti `IN_PLACE` dengan hook, shadow root dengan `SAFE_FOR_TEMPLATES`, atau allowlist SVG XHTML. **Eksploitasi melalui jalur laporan FiberOps tidak dibuktikan.** Menutup dependency yang diketahui rentan tidak sama dengan menyatakan endpoint aplikasi telah tereksploitasi.
- Patch memperbaiki penggunaan snapshot server sebelum body lengkap, bukan menambahkan version locking/edit kolaboratif. Dua form lama yang mengirim perubahan pada field yang sama tetap memakai perilaku last-write-wins. Koordinasikan input antaroperator.
- Uji kegagalan SQL menggunakan trigger `RAISE(ABORT)` hanya pada DB sementara untuk menguji rollback. Ini bukan uji disk/listrik rusak pada host produksi.

## Bukti pengujian

Lingkungan: Node **22.22.3**, npm **10.9.8**, Chromium **153.0.8010.0**. Browser menggunakan build produksi dengan web security tetap aktif; viewport desktop dan 390×844. Bukan ponsel fisik.

| Pemeriksaan | Sebelum perbaikan terkait | Setelah perbaikan |
| --- | --- | --- |
| Regresi API tambahan (`audit-regression-api.mjs`) | **0 lulus / 15 gagal** pada salinan server `37df297` | **15 lulus / 0 gagal** |
| Regresi DOMPurify (`dependency-security.mjs`) | **7 lulus / 12 gagal** pada 3.4.16 | **19 lulus / 0 gagal** pada 3.4.17 |
| Audit UI lama + skenario pending baru | **19 lulus / 1 gagal** | **20 lulus / 0 gagal** |
| Instalasi ulang lockfile `npm ci` | — | Lulus; 160 paket terpasang |
| `npm run build` setelah instalasi bersih | — | Lulus |
| `npm test` setelah instalasi bersih | — | Seluruh suite lulus, termasuk 34 regresi API/dependency baru |
| Browser produksi `test:browser` | — | **18 pemeriksaan lulus**; tidak ada exception JavaScript tertangkap |
| `test:render` | — | **10 rute lulus**, ditambah pengalihan operator dari halaman admin |
| `test:update-native` | — | **15 skenario lulus**; Git/npm/systemctl dimock, SQLite/API/UID nyata |
| `npm audit` | 1 paket berseverity critical, dengan 3 advisori | **0 kerentanan yang diketahui** saat pemeriksaan |
| `git diff --check`, pemeriksaan sintaks shell/Node | — | Lulus |

Angka kasus gagal bukan jumlah kerentanan terpisah. Handshake HTTP `100 Continue` dipakai dalam regresi request tertunda supaya hasil tidak bergantung pada urutan koneksi TCP/keep-alive.

Suite lengkap juga menjalankan 70 logika core/topologi, 20 logika interface, 99 permintaan API interface, 22 logika laporan interface, 117 CRUD/login/peran, pengujian layout runtime/UI interface, 8 klien + 15 API audit, 15 API + 16 UI dashboard, serta 17 keamanan + 24 API + 16 CLI pra-deploy.

Browser memeriksa login/reload, role baca, model/card unknown, simpan lambat OLT/card/ODC/ODP/core/user, error+retry, mapping, CSV nyata/filter/formula, canvas/worker/unduhan PDF, menu mobile, Origin asing dengan cookie sah, serta proxy yang menyaring Authorization/cookie. Penolakan Origin, login, dashboard dan logout juga diuji dengan Host/Origin preview eksternal sebenarnya.

## Pelestarian data dan aturan lapangan

- Dibuat backup SQLite konsisten dan snapshot source sebelum perbaikan. Semua mutasi/fault injection pengujian menggunakan fixture/database sementara, bukan inventaris pengguna.
- Setelah restart preview dengan kode perbaikan, **seluruh baris, kolom, dan ID pada 11 tabel jaringan demo identik**: 2 OLT, 3 card, 6 port, 3 ODC, 4 ODP, 3 feeder, 3 mapping interface, 15 assignment core, 1 kabel langsung, 7 splitter, 52 output. `quick_check=ok`, pelanggaran FK **0**.
- Pembuktian tersebut berlaku pada **demo yang tersedia**, bukan verifikasi database Proxmox yang belum diakses. Aktivitas login dapat mengubah sesi/hash legacy sebagaimana dirancang; inventaris tidak di-reset.
- Tidak ada inventaris hasil tebakan/discovery, kapasitas berdasarkan nama, telemetri optik, SSH, atau SNMP yang ditambahkan. Penamaan C300/C320 shelf/slot/port dan dukungan PON/manual HSGQ dipertahankan.
- Mapping sumber tetap eksplisit; receiver/cabang dan ID sambungan membedakan kabel yang memiliki nomor/warna core sama. Sumber tidak pasti tetap belum dipetakan. Aktif/manual dan port terpakai dihitung terpisah, sekali per port fisik. Aturan ODP existing 1:8 tidak diubah.

## Updater native dan batas operasional

`PERINTAH-UPDATE-PROXMOX.md` berisi satu blok salin-tempel; isinya diuji identik dengan `scripts/update-native.sh`. Helper menjaga pemeriksaan akun sebelum stop, backup privat konsisten termasuk WAL, preflight, health, serta ID lama. Tidak membuat/menghapus user, mengganti password, mereset DB, mengedit unit/environment atau melakukan rollback buta. Gagal setelah maintenance membuat service tetap berhenti untuk ditinjau operator. Harness memakai fixture: **bukan bukti systemd/Proxmox sungguhan sudah diuji**.

Review PR dahulu. Sebelum produksi, identifikasi instalasi/path DB/user service yang sebenarnya, siapkan maintenance dan backup off-host, uji restore/staging, baca penghalang/peringatan preflight, dan verifikasi inventaris/jalur di lokasi. Panduan: [DEPLOY-PROXMOX.md](DEPLOY-PROXMOX.md), [perintah salin-tempel native](PERINTAH-UPDATE-PROXMOX.md).

Belum diperiksa: host Proxmox, TLS/firewall/DNS, container Docker nyata, disk/listrik rusak, beban produksi, semua browser/perangkat, pentest independen, dan kesesuaian sambungan fisik. Peringatan nonfatal ukuran chunk Vite, SQLite eksperimental pada Node 22, dan rekomendasi legacy PDF.js pada tes Node masih ada.

## Menjalankan ulang

```bash
npm ci
npm run build
npm test                 # sudah termasuk test:regression
npm run test:regression  # 15 API + 19 dependency, DB sementara
# Opt-in; Chromium lokal tersedia:
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
# Hanya lingkungan uji Linux dengan sudo -n, bukan terminal produksi:
npm run test:update-native
# Memerlukan server demo pengembangan yang sedang berjalan:
npm run test:render
```

Advisori referensi: [GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr), [GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7), [GHSA-c6gr-qvv4-5v3f](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f).
