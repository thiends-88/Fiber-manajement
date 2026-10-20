# Audit pra-deploy — 20 Oktober 2026

## Kesimpulan

**Temuan yang berhasil direproduksi sudah diperbaiki dan regresinya lulus. Ini bukan jaminan aplikasi bebas seluruh bug, sertifikasi keamanan, atau bukti server Proxmox sudah aman.**

Audit dikerjakan pada source branch `arena/126762c1-fiber-manajement`, dengan pembanding commit `20bae42`, database sementara dan data **demo** preview. Tidak ada akses ke Proxmox, database produksi, konfigurasi jaringan produksi, atau OLT fisik pengguna. Perubahan diajukan lewat **[PR #9](https://github.com/thiends-88/Fiber-manajement/pull/9)**; audit ini tidak melakukan merge atau deployment.

**Keputusan operasional:** layak dilanjutkan ke review/staging terkontrol. Produksi baru dibuka setelah backup yang benar, admin/password pribadi, preflight, konfigurasi keamanan server dan verifikasi inventaris/jalur di lokasi memenuhi checklist. Jangan langsung memperbarui server hanya karena tes source lulus.

## Bagaimana diperiksa

1. Build dan seluruh tes lama dijalankan terlebih dahulu: lulus, tetapi belum mencakup temuan di bawah.
2. Sumber `20bae42` diarsipkan dan diuji dengan 17 pemeriksaan awal terisolasi: **3 lulus / 14 gagal**. Ini jumlah kasus uji, **bukan 14 kerentanan terpisah**. Di antaranya permintaan raw HTTP dengan `Host: [` benar-benar memutus koneksi/mematikan server lama.
3. Bug PDF ditelusuri melalui Chromium nyata terhadap server yang menyajikan **build produksi**, bukan Vite: worker `.mjs` mendapat `application/octet-stream`, pratinjau gagal dan tidak menghasilkan canvas.
4. Salinan DB disiapkan dengan lima kolom pengukuran lama dan satu catatan input cascade. Startup versi lama menyisakan **0/5 kolom dan 0 catatan**, sedangkan versi perbaikan mempertahankan **5/5 kolom dan 1 catatan**, dengan `quick_check=ok`.
5. Perbaikan ditambah pengujian API, unit keamanan, CLI/runtime, backup WAL, Chromium serta pemeriksaan ulang seluruh suite. Seluruh mutasi uji menggunakan DB sementara, kecuali pembuatan/pencabutan sesi pada preview demo.

## Temuan dan penutupan

Prioritas berikut berdasarkan dampak aplikasi yang diamati, bukan skor CVSS/pentest menyeluruh.

| Prioritas | Temuan terverifikasi | Perbaikan dan bukti penutupan |
| --- | --- | --- |
| Tinggi | Token sesi dikirim pada URL dan diterima sebagai autentikasi. Parameter token ter-encode juga dapat lolos dari redaksi log lama. | SDK tidak menambah token URL; server tidak menerima autentikasi query. Bearer, `X-Fiberops-Token` khusus proxy, dan cookie tetap mendukung sesi sah. Redaksi nama parameter encoded/duplikat diperketat. Sesi pra-perbaikan dicabut sekali. |
| Tinggi | Login/permintaan tulis tidak membatasi Origin asing ketika kredensial sesi disertakan. | Pemeriksaan Origin dan Fetch Metadata sebelum routing mutasi. Foreign/null Origin dan cross-site write ditolak 403. Browser nyata dengan cookie sah dan Origin berbeda juga mendapat 403 tanpa penambahan inventaris. Klien API non-browser tanpa Origin tetap harus memiliki autentikasi yang sah. |
| Tinggi | Host/URL rusak dapat menyebabkan exception sebelum penanganan error router dan mematikan proses. | Validasi URL/Host di dalam handler; input rusak mendapat 400 dan health masih hidup sesudahnya. |
| Tinggi | Password/akun demo dapat dipakai ketika server lama diberi mode production; path DB baru dapat menghasilkan demo dan tampak seperti deployment yang berhasil. | `NODE_ENV=production` menolak DB/build hilang atau pengguna kosong. Password pabrik serta sesi akun yang masih memakai password pabrik diblokir. Bootstrap/rotasi CLI tidak membuat inventaris demo. |
| Tinggi — integritas data | Receiver ODC yang sudah dihapus/dikosongkan dapat terisi kembali dari kandidat lain saat restart. | Terjemahan referensi core legacy hanya pada pengenalan kolom receiver pertama, dengan kecocokan unik; restart normal tidak mengisi NULL yang disengaja. Relasi ODC tetap ada, receiver belum diketahui tetap perlu dipilih di lapangan. Snapshot jaringan dibandingkan sebelum/sesudah restart. |
| Tinggi — integritas data | Startup membuang kolom pengukuran lama dan membersihkan input/catatan cascade; error migrasi tertentu ditelan. | Tidak lagi melakukan pembuangan/pembersihan data legacy otomatis. API tetap menghilangkan field pengukuran lama dari respons, tanpa menghapus nilai di DB/backup. Error schema/rebuild menjadi fatal; pemindahan feeder legacy dibuat transaksional dan di-rollback jika gagal, termasuk pada percobaan restart berikutnya. |
| Tinggi — operasional | Panduan menyalin `.db` aktif dengan `cp`/cron, restore tanpa memisahkan WAL/SHM, dan reset dengan menghapus DB. | Panduan diganti dengan backup SQLite konsisten, stop penulis, karantina set DB/WAL/SHM gagal, pasangan kode + DB untuk rollback, serta verifikasi volume Docker. Regresi membuktikan salinan main-file saja tidak memuat transaksi yang masih ada di WAL, sementara snapshot SQLite memuatnya. |
| Sedang | Tidak ada pembatas login yang terukur; input password nonteks ditoleransi sebagai konversi string. | Batas 30 percobaan/10 menit/alamat, ukuran/tipe input dibatasi, respons 429 dengan Retry-After. IP socket dipakai default; X-Forwarded-For palsu tidak melewati kuota. Trusted proxy hanya opt-in IP eksplisit dengan X-Real-IP valid. |
| Sedang | Respons sensitif/HTML tidak diberi kebijakan cache yang memadai, cookie Secure belum dapat dikonfigurasi dan detail error internal bisa dikirim ke klien. | API/HTML no-store, nosniff dan no-referrer; aset hashed immutable. Flag Secure pada login/logout untuk konfigurasi HTTPS. Error 500 generik; detail hanya di log server yang perlu dibatasi aksesnya. Umask privat, timeout HTTP dan shutdown SQLite ditambahkan. |
| Sedang — fungsi | Pratinjau PDF build produksi gagal memuat worker walau tes jsdom dan unduhan PDF lulus. | `.mjs` dilayani dengan MIME JavaScript. Chromium benar-benar merender canvas PDF beberapa halaman; file unduhan memiliki header PDF sah. |
| Sedang — UI/data entry | Form edit menampilkan pilihan bawaan ketika model/card tersimpan tidak ada dalam dropdown; form OLT/card dapat ditutup/diubah saat simpan berlangsung. | Nilai kosong/tak dikenal ditampilkan sebagaimana tersimpan, termasuk `GTHG`, tanpa disulap menjadi GTGO/model lain. Field dan penutupan form dijaga saat request belum selesai. Uji browser dengan respons PATCH ditahan lulus. |
| Operasional runtime | Hardening memerlukan helper/CLI yang harus ikut masuk runtime Docker; data image lama dapat dimiliki root. | Dockerfile menyalin helper/CLI yang diperlukan, mode production dan user node. Tata letak runtime diuji tanpa node_modules, termasuk bootstrap, login production dan preflight. Panduan mewajibkan pemeriksaan mount/ownership sebelum update. **Build/container Docker nyata belum diuji di lingkungan ini.** |

Header khusus `X-Fiberops-Token` menggantikan kebutuhan fallback URL pada proxy yang menyaring Authorization/cookie. Nilainya tetap rahasia seperti Bearer. Browser diuji dengan Authorization disaring dan cookie dibersihkan: login/reload berhasil melalui header khusus, sedangkan fetch tanpa kredensial mendapat 401. Ini simulasi perilaku proxy; bukan audit infrastruktur gateway Arena/Proxmox.

## Hasil pengujian

Lingkungan eksekusi: **Node 22.22.3**, npm 10.9.8, Chromium **153.0.8010.0**. Browser tidak dijalankan dengan flag yang menonaktifkan web security/site isolation. Viewport utama 1440×1000, responsif 390×844; bukan pengujian ponsel fisik.

| Pemeriksaan | Hasil |
| --- | --- |
| Instalasi lockfile bersih `npm ci` | Lulus |
| `npm run build` | Lulus |
| `npm test` — seluruh suite lama dan baru | Lulus |
| Logika topologi/core lama | 70 lulus |
| Logika interface | 20 lulus |
| API interface/migrasi | 99 permintaan terverifikasi |
| CRUD/login/peran API lama | 117 lulus |
| Audit klien/API/UI sebelumnya | 8 + 15 + 19 lulus |
| Dashboard per OLT/card | 15 API + 16 UI lulus |
| Regresi pra-deploy baru (`test:predeploy`) | **57 lulus:** 17 logika keamanan + 24 API + 16 CLI/runtime/backup |
| Chromium build produksi (`test:browser`, opt-in) | **14 lulus** |
| Render seluruh route + pengalihan operator | 10 route lulus; operator ditolak dari halaman admin |
| `npm audit --json` | **0 kerentanan yang diketahui** pada metadata 217 dependensi, termasuk platform opsional |
| `git diff --check` | Lulus |

**71 pemeriksaan pra-deploy/browser baru lulus**, di samping suite sebelumnya. Angka ini tidak berarti seluruh kemungkinan input/serangan sudah diperiksa.

Cakupan browser: login/reload, rincian OLT/card dan hitungan manual versus mapping, payload HTML tersimpan menjadi teks, tautan ID yang tepat, edit model/card unknown, form simpan lambat, mapping lewat UI, CSV nyata sesuai filter dan formula dinetralkan, worker/canvas PDF dan unduhan, menu/accordion mobile, CSRF dengan cookie, akses reader serta fallback proxy tanpa token URL. Tidak ada exception JavaScript yang tertangkap selama skenario tersebut.

Cakupan CLI: bootstrap tidak menimpa akun; Unicode password dipertahankan; rotasi menjaga identitas/role dan mencabut sesi; preflight read-only menolak path salah, akun/hash tidak aman, posisi card ganda, FK rusak dan kapasitas port salah; startup produksi tidak men-seed demo; pemindahan feeder lama berhasil atau gagal transaksional tanpa menyembunyikan data rusak; backup menyertakan WAL dan tidak menimpa backup lama.

Peringatan nonfatal yang masih muncul: SQLite eksperimental pada Node 22, peringatan ukuran chunk Vite >500 kB, dan rekomendasi legacy build PDF.js pada tes Node. Ini bukan bukti gangguan runtime, tetapi tetap perlu diperhatikan untuk pembaruan dependensi/performa berikutnya.

### Integritas data demo preview

Sebelum restart dibuat snapshot SQLite konsisten. Sesudah restart dengan kode perbaikan, **11 tabel jaringan dibandingkan seluruh baris/kolom dan ID-nya: tidak ada perubahan**. `quick_check=ok`, foreign-key violation **0**. Direktori/file DB demo dibatasi 0700/0600. Auth mendapat tabel metadata `security_migrations` dan sesi lama memang dicabut; ini perubahan yang disengaja, bukan kehilangan inventaris.

Pembandingan tersebut berlaku pada **demo yang tersedia**, bukan jaminan bahwa DB produksi yang belum diberikan akan identik. Tidak ada OLT C300/C320, card atau kapasitas fisik baru yang disisipkan ke inventaris pengguna. Contoh OLT-001/GTHG pada fixture browser adalah data uji sementara, bukan hasil penemuan perangkat.

Proxy Vite yang hidup juga diperiksa: login lewat proxy, autentikasi header khusus tanpa Authorization/cookie, penolakan Origin asing, logout, dan dashboard mendapat respons sesuai harapan. Host browser dipertahankan ke backend; URL API di frontend tetap relatif.

## Yang belum dapat dijamin / perlu keputusan operator

- **Host Proxmox belum diperiksa:** versi OS/Node aktual, resource/disk, backup storage, waktu/NTP, UID/izin, systemd/Docker nyata, firewall, DNS, sertifikat/TLS, proxy dan akses pengguna. Template deployment perlu diuji pada salinan lingkungan Anda.
- **Tidak ada validasi fisik:** posisi shelf/slot, kapasitas card, patchcord/ODF, label kabel, receiver ODC anak, dan core/warna yang berulang harus diperiksa teknisi. Data/mapping salah yang sudah terlanjur tersimpan tidak dapat dikenali atau dipulihkan dengan menebak. Nilai lama yang telah dibuang versi sebelumnya memerlukan backup sebelum kejadian itu.
- Aturan ODP existing tetap **splitter 1:8 bawaan/permanen**. ODP tanpa splitter/rasio lain belum dimodelkan form/API saat ini; preflight memperingatkan ODP legacy yang belum punya splitter karena aturan existing akan menambah 1:8 saat startup. Konfirmasi model ini jika lapangan berbeda.
- **Aktif ≠ terpakai**. Aktif adalah catatan manual; terpakai adalah mapping eksplisit yang valid, dihitung sekali per port. Keduanya tumpang tindih, tidak dijumlahkan dan bukan monitoring OLT langsung. Builtin port container bukan card fisik terpasang.
- Belum ada uji beban produksi, kegagalan disk/listrik, pentest independen atau fuzzing menyeluruh. Pembatas login berada di memori dan reset saat restart, bukan mitigasi DDoS penuh. NAT/proxy dapat berbagi kuota jika alamat klien tepercaya tidak dikonfigurasi benar.
- Token masih memakai fallback memori/localStorage selain cookie HttpOnly. XSS pada fitur/dependensi masa depan tetap dapat membahayakan sesi; satu payload tersimpan yang aman tidak membuktikan semua XSS mustahil. Gunakan HTTPS, akses terbatas/VPN, kebijakan frame/CSP di gateway produksi yang sesuai, update dependensi dan jangan menyimpan/membagikan token di log.
- Hash legacy SHA-256 tetap dibaca untuk kompatibilitas dan di-upgrade setelah login valid. Rotasi lokal dapat memperbaruinya lebih dulu. Preflight mendeteksi password pabrik/format hash rusak, **tidak membuktikan kekuatan atau keunikan semua password nonpabrik**. Gunakan akun per orang dan password unik.
- Uji browser dilakukan pada Chromium desktop dengan viewport mobile, bukan Android/iOS fisik, semua browser, atau iframe/gateway eksternal dalam semua kebijakan privasi.

## Langkah sebelum update Proxmox

Runbook lengkap dan perintah dipisahkan untuk native dan Docker di **[DEPLOY-PROXMOX.md](DEPLOY-PROXMOX.md)**.

1. **Review/merge versi yang benar**, identifikasi native versus Docker serta path/volume yang sebenarnya; catat revision/image dan konfigurasi lama.
2. **Maintenance & backup konsisten** DB + kode/config sebelum migrasi/password berubah. Simpan off-host, verifikasi isinya dan coba restore pada salinan. Jangan memakai `cp .db` aktif.
3. **Siapkan admin/password pribadi** via stdin lokal (`create-admin.mjs` / `set-password.mjs`). Jangan mengirim rahasia ke chat atau menaruh password di argv/history.
4. **Build dan jalankan preflight** dengan user service pada DB kerja/salinan yang tepat. Jangan menghapus ID untuk menutupi konflik. Selesaikan penghalang; baca peringatan legacy/receiver/ODP.
5. **Production + HTTPS/VPN + izin benar**. Verifikasi Origin/cookie/proxy, hindari backend publik langsung, pastikan hanya satu penulis dan volume Docker tidak berubah.
6. **Hard-refresh, login ulang dan smoke test lokasi:** bandingkan inventaris; pilih sampel C300 dan C320, telusuri interface→core→splitter/receiver→ODP, cek CSV/PDF dan akses reader/operator.
7. Bila ada ketidaksesuaian: **jangan buka maintenance**. Stop penulis, simpan kondisi gagal, pulihkan pasangan kode + DB backup, pisahkan WAL/SHM lama. Rekonsiliasi perubahan setelah backup bila ada; jangan reset ke demo.

**Go/no-go:** jangan menyebut produksi “aman” sebelum langkah di atas terpenuhi pada server sebenarnya. Hasil audit source ini menutup temuan yang diketahui dalam cakupan uji, bukan menggantikan verifikasi tersebut.
