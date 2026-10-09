// Uji API menyeluruh: auth, hak akses, CRUD semua entitas, penjaga validasi
// (splitter rasio, cascade, lingkaran ODC induk/anak, port feeder), mapping core,
// user, laporan, dan anggaran daya dari data nyata server.
//
// Menjalankan server SENDIRI dengan database sementara (port & DB terpisah),
// jadi aman dijalankan kapan saja tanpa mengganggu data produksi:
//   npm run test:api
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.UJI_API_PORT || 4599);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiberops-uji-"));
const DB = path.join(TMP, "uji.db");

let lolos = 0;
let gagal = 0;
const kegagalan = [];

function cek(nama, kondisi, detail = "") {
  if (kondisi) {
    lolos++;
    console.log(`  OK    ${nama}`);
  } else {
    gagal++;
    kegagalan.push(nama);
    console.log(`  GAGAL ${nama}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- helper HTTP -----------------------------------------------------------
async function api(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await r.json();
  } catch {
    /* respons tanpa JSON */
  }
  return { status: r.status, data };
}
const GET = (p, t) => api("GET", p, null, t);
const POST = (p, b, t) => api("POST", p, b, t);
const PATCH = (p, b, t) => api("PATCH", p, b, t);
const DEL = (p, t) => api("DELETE", p, null, t);

// --- nyalakan server uji ---------------------------------------------------
let server;
function nyalakanServer() {
  return new Promise((resolve, reject) => {
    server = spawn("node", ["server.mjs"], {
      cwd: ROOT,
      env: { ...process.env, ARENA_API_PORT: String(PORT), ARENA_DB_PATH: DB },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server tidak siap: ${out}`)), 20000);
    server.stdout.on("data", (d) => {
      out += d.toString();
      if (out.includes("siap di")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on("data", (d) => {
      out += d.toString();
    });
    server.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server mati (kode ${code}): ${out}`));
    });
  });
}

async function main() {
  console.log("\n=== UJI API: server uji (database sementara) ===");
  await nyalakanServer();
  console.log(`  server uji siap di ${BASE} (DB: ${DB})`);

  // ---------------------------------------------------- 1. Auth & sesi
  console.log("\n--- 1) Login, sesi, dan keamanan ---");
  const health = await GET("/healthz");
  cek("GET /healthz → 200", health.status === 200 && health.data?.ok === true);

  const tanpaToken = await GET("/api/me");
  cek("akses API tanpa login → 401", tanpaToken.status === 401, `status ${tanpaToken.status}`);

  const tokenPalsu = await GET("/api/olts", "token-yang-tidak-ada");
  cek("token palsu → 401", tokenPalsu.status === 401, `status ${tokenPalsu.status}`);

  const salahPassword = await POST("/api/login", { email: "admin@arena.test", password: "salah-sekali" });
  cek("password salah → 401", salahPassword.status === 401, `status ${salahPassword.status}`);

  const emailTidakAda = await POST("/api/login", { email: "budi@contoh.id", password: "Apa12345" });
  cek("email tidak terdaftar → 401", emailTidakAda.status === 401, `status ${emailTidakAda.status}`);

  const loginAdmin = await POST("/api/login", { email: "admin@arena.test", password: "Arena123!" });
  const admin = loginAdmin.data?.token;
  cek("login admin → 200 + token", loginAdmin.status === 200 && !!admin);
  cek("data user admin lengkap", loginAdmin.data?.user?.role === "admin" && !!loginAdmin.data?.user?.email);

  const me = await GET("/api/me", admin);
  cek("GET /api/me → data admin", me.status === 200 && me.data?.user?.email === "admin@arena.test");

  const loginOperator = await POST("/api/login", { email: "operator@arena.test", password: "Arena123!" });
  const operator = loginOperator.data?.token;
  cek("login operator → 200 + token", loginOperator.status === 200 && !!operator);

  // ---------------------------------------------------- 2. Hak akses
  console.log("\n--- 2) Hak akses per peran ---");
  const operatorBuatOlt = await POST("/api/olts", { name: "OLT-UJI-OPERATOR" }, operator);
  cek("operator boleh menambah OLT", operatorBuatOlt.status === 201, `status ${operatorBuatOlt.status}`);
  if (operatorBuatOlt.status === 201) await DEL(`/api/olts/${operatorBuatOlt.data.id}`, operator);

  const operatorLihatUser = await GET("/api/users", operator);
  cek("operator TIDAK boleh lihat daftar user → 403", operatorLihatUser.status === 403, `status ${operatorLihatUser.status}`);

  const operatorBuatUser = await POST(
    "/api/users",
    { email: "coba@contoh.id", full_name: "Coba", password: "Rahasia123", role: "user" },
    operator,
  );
  cek("operator TIDAK boleh membuat user → 403", operatorBuatUser.status === 403, `status ${operatorBuatUser.status}`);

  const userBaru = await POST(
    "/api/users",
    { email: "uji-baca@contoh.id", full_name: "Uji Baca", password: "Rahasia123", role: "user" },
    admin,
  );
  cek("admin bisa membuat user peran 'user'", userBaru.status === 201, `status ${userBaru.status}`);
  const loginBaca = await POST("/api/login", { email: "uji-baca@contoh.id", password: "Rahasia123" });
  cek("user baru bisa login", loginBaca.status === 200 && !!loginBaca.data?.token);
  const bacaTambah = await POST("/api/olts", { name: "OLT-UJI-BACA" }, loginBaca.data?.token);
  cek("peran 'user' (baca saja) → tolak ubah data 403", bacaTambah.status === 403, `status ${bacaTambah.status}`);
  const bacaLihat = await GET("/api/olts", loginBaca.data?.token);
  cek("peran 'user' tetap boleh melihat data", bacaLihat.status === 200);

  // ---------------------------------------------------- 3. OLT / kartu / port
  console.log("\n--- 3) OLT, kartu, dan port ---");
  const oltTanpaNama = await POST("/api/olts", { olt_type: "ZTE C320" }, admin);
  cek("OLT tanpa nama → 400", oltTanpaNama.status === 400, `status ${oltTanpaNama.status}`);

  const olt = await POST(
    "/api/olts",
    { name: "OLT-UJI-01", olt_type: "Huawei MA5800", location: "POP Uji", ip: "10.99.0.1", notes: "dibuat oleh uji" },
    admin,
  );
  cek("tambah OLT → 201", olt.status === 201, `status ${olt.status}`);
  const oltId = olt.data?.id;
  cek("OLT baru punya id", Number.isInteger(oltId));

  const oltUbah = await PATCH(`/api/olts/${oltId}`, { name: "OLT-UJI-01B", olt_type: "Huawei MA5800", location: "POP Uji" }, admin);
  cek("ubah OLT → 200 + nama berubah", oltUbah.status === 200 && oltUbah.data?.name === "OLT-UJI-01B");

  const daftarOlt = await GET("/api/olts", admin);
  cek("OLT muncul di daftar (dengan jumlah kartu/ODC)", Array.isArray(daftarOlt.data) && daftarOlt.data.some((o) => o.id === oltId && "card_count" in o && "odc_count" in o));

  const kartu = await POST("/api/cards", { olt_id: oltId, slot: 1, card_type: "GTGO", port_count: 8 }, admin);
  cek("tambah kartu OLT → 201", kartu.status === 201, `status ${kartu.status}`);
  const kartuId = kartu.data?.id;
  const kartuTanpaSlot = await POST("/api/cards", { olt_id: oltId }, admin);
  cek("kartu tanpa slot → 400", kartuTanpaSlot.status === 400, `status ${kartuTanpaSlot.status}`);

  const port = await POST(
    "/api/ports",
    { card_id: kartuId, port: 1, sfp: "Class B+", status: "active" },
    admin,
  );
  cek("tambah port OLT → 201", port.status === 201, `status ${port.status}`);
  const portId = port.data?.id;
  const portTanpaNomor = await POST("/api/ports", { card_id: kartuId }, admin);
  cek("port tanpa nomor → 400", portTanpaNomor.status === 400, `status ${portTanpaNomor.status}`);

  const portOltLain = await POST("/api/ports", { card_id: kartuId, port: 2, sfp: "GPON" }, admin);
  const portOltLain2 = await POST("/api/ports", { card_id: kartuId, port: 3, sfp: "GPON" }, admin);

  const portUbah = await PATCH(`/api/ports/${portId}`, { card_id: kartuId, port: 1, serial: "SFP-0001", status: "active" }, admin);
  cek("ubah port (serial + status) → 200", portUbah.status === 200 && portUbah.data?.serial === "SFP-0001", `serial=${portUbah.data?.serial}`);

  // ---------------------------------------------------- 4. ODC + port feeder
  console.log("\n--- 4) ODC dan port feeder (banyak input) ---");
  const odcTanpaKabel = await POST("/api/odcs", { name: "ODC-UJI", olt_id: oltId }, admin);
  cek("ODC tanpa tipe kabel → 400", odcTanpaKabel.status === 400, `status ${odcTanpaKabel.status}`);

  const odcFeederSalahOlt = await POST(
    "/api/odcs",
    { name: "ODC-UJI", olt_id: oltId, cable_type: "48_core_8_tube", feeder_port_ids: [999999] },
    admin,
  );
  cek("port feeder yang tidak ada → 400", odcFeederSalahOlt.status === 400, `status ${odcFeederSalahOlt.status}`);

  const odc = await POST(
    "/api/odcs",
    {
      name: "ODC-UJI-01",
      olt_id: oltId,
      cable_type: "48_core_8_tube",
      feeder_port_ids: [portId, portOltLain.data.id], // banyak input feeder
    },
    admin,
  );
  cek("tambah ODC → 201", odc.status === 201, `status ${odc.status}`);
  const odcId = odc.data?.id;

  const feederOdc = await GET(`/api/feeder-ports?odc_id=${odcId}`, admin);
  cek("ODC punya 2 port feeder (multi-input)", Array.isArray(feederOdc.data) && feederOdc.data.length === 2, `${feederOdc.data?.length}`);

  const odcUbahFeeder = await PATCH(
    `/api/odcs/${odcId}`,
    { name: "ODC-UJI-01", olt_id: oltId, cable_type: "48_core_8_tube", feeder_port_ids: [portId] },
    admin,
  );
  cek("ubah feeder ODC → 200", odcUbahFeeder.status === 200);
  const feederSetelahUbah = await GET(`/api/feeder-ports?odc_id=${odcId}`, admin);
  cek("feeder terganti (bukan menumpuk) → 1 port", feederSetelahUbah.data?.length === 1, `${feederSetelahUbah.data?.length}`);

  // ---------------------------------------------------- 5. ODP
  console.log("\n--- 5) ODP ---");
  const odp = await POST("/api/odps", { odc_id: odcId, name: "ODP-UJI-01", cable_type: "12_core_2_tube" }, admin);
  cek("tambah ODP → 201", odp.status === 201, `status ${odp.status}`);
  const odpId = odp.data?.id;
  const odpUbah = await PATCH(`/api/odps/${odpId}`, { odc_id: odcId, name: "ODP-UJI-01B", cable_type: "12_core_2_tube" }, admin);
  cek("ubah ODP → 200", odpUbah.status === 200 && odpUbah.data?.name === "ODP-UJI-01B");

  // ---------------------------------------------------- 6. Splitter
  console.log("\n--- 6) Splitter: rasio, penempatan, cascade, ODC anak ---");
  const splRasioSalah = await POST("/api/splitters", { name: "SPL-UJI", ratio: "1:3", odc_id: odcId }, admin);
  cek(
    "rasio 1:3 (tidak ditawarkan UI) → 400",
    splRasioSalah.status === 400,
    `status ${splRasioSalah.status} ${splRasioSalah.data?.error ?? ""}`,
  );

  const splTanpaTempat = await POST("/api/splitters", { name: "SPL-UJI", ratio: "1:8" }, admin);
  cek("splitter tanpa ODC/ODP → 400", splTanpaTempat.status === 400, `status ${splTanpaTempat.status}`);

  const splTanpaNama = await POST("/api/splitters", { ratio: "1:8", odc_id: odcId }, admin);
  cek("splitter tanpa nama → 400", splTanpaNama.status === 400, `status ${splTanpaNama.status}`);

  const splInduk = await POST("/api/splitters", { name: "SPL-UJI-1", ratio: "1:4", odc_id: odcId }, admin);
  cek("splitter 1:4 di dalam ODC → 201", splInduk.status === 201, `status ${splInduk.status}`);
  const splIndukId = splInduk.data?.id;
  cek("splitter 1:4 membuat 4 port output", splInduk.data?.outputs?.length === 4, `${splInduk.data?.outputs?.length}`);

  const splAnak = await POST("/api/splitters", { name: "SPL-UJI-2", ratio: "1:8", odc_id: odcId }, admin);
  const splAnakId = splAnak.data?.id;
  cek("splitter 1:8 (cascade) di ODC yang sama → 201", splAnak.status === 201 && splAnak.data?.outputs?.length === 8);

  const splDiOdp = await POST("/api/splitters", { name: "SPL-UJI-ODP", ratio: "1:8", odp_id: odpId }, admin);
  const splDiOdpId = splDiOdp.data?.id;
  cek("splitter boleh juga di DALAM ODP → 201", splDiOdp.status === 201 && splDiOdp.data?.outputs?.length === 8);

  // cascade: output SPL-UJI-1 #1 → SPL-UJI-2
  const outCascade = splInduk.data?.outputs?.[0];
  const cascade = await PATCH(
    `/api/splitter-outputs/${outCascade.id}`,
    { target_type: "splitter", target_id: splAnakId },
    admin,
  );
  cek("cascade splitter (1:4 → 1:8) → 200", cascade.status === 200 && cascade.data?.target_type === "splitter", `status ${cascade.status}`);

  const cascadeSendiri = await PATCH(
    `/api/splitter-outputs/${outCascade.id}`,
    { target_type: "splitter", target_id: splIndukId },
    admin,
  );
  cek("cascade ke diri sendiri → 400", cascadeSendiri.status === 400, `status ${cascadeSendiri.status}`);

  // output splitter di ODC → ODP
  const outKeOdp = splAnak.data?.outputs?.[0];
  const keOdp = await PATCH(`/api/splitter-outputs/${outKeOdp.id}`, { target_type: "odp", target_id: odpId }, admin);
  cek("output splitter diarahkan ke ODP → 200", keOdp.status === 200 && keOdp.data?.target_type === "odp", `status ${keOdp.status}`);

  const keOdpPalsu = await PATCH(`/api/splitter-outputs/${outKeOdp.id}`, { target_type: "odp", target_id: 999999 }, admin);
  cek("output ke ODP yang tidak ada → 400", keOdpPalsu.status === 400, `status ${keOdpPalsu.status}`);

  // splitter di ODP tidak boleh mengarah ke ODC lain
  const outOdp = splDiOdp.data?.outputs?.[0];
  const odpKeOdc = await PATCH(`/api/splitter-outputs/${outOdp.id}`, { target_type: "odc", target_id: odcId }, admin);
  cek(
    "splitter di dalam ODP TIDAK boleh ke ODC lain → 400",
    odpKeOdc.status === 400 && /Hanya splitter di dalam ODC/.test(odpKeOdc.data?.error || ""),
    odpKeOdc.data?.error,
  );

  // ODC anak: ODC kedua diumpan dari output splitter ODC pertama
  const odcAnak = await POST(
    "/api/odcs",
    { name: "ODC-UJI-ANAK", olt_id: oltId, cable_type: "24_core_4_tube", feeder_port_ids: [portOltLain2.data.id] },
    admin,
  );
  const odcAnakId = odcAnak.data?.id;
  cek("tambah ODC anak → 201", odcAnak.status === 201, `status ${odcAnak.status}`);

  const outKeOdcAnak = splInduk.data?.outputs?.[1];
  const keOdcAnak = await PATCH(`/api/splitter-outputs/${outKeOdcAnak.id}`, { target_type: "odc", target_id: odcAnakId }, admin);
  cek("output splitter ODC → ODC anak → 200", keOdcAnak.status === 200 && keOdcAnak.data?.target_type === "odc", `status ${keOdcAnak.status}`);

  // lingkaran: coba jadikan ODC induk sebagai anak dari ODC anak-nya
  const splDiAnak = await POST("/api/splitters", { name: "SPL-UJI-ANAK1", ratio: "1:8", odc_id: odcAnakId }, admin);
  const lingkaran = await PATCH(
    `/api/splitter-outputs/${splDiAnak.data?.outputs?.[0].id}`,
    { target_type: "odc", target_id: odcId },
    admin,
  );
  cek(
    "lingkaran ODC induk/anak dicegah → 400",
    lingkaran.status === 400 && /lingkaran/.test(lingkaran.data?.error || ""),
    lingkaran.data?.error,
  );

  // ---------------------------------------------------- 7. Core & mapping
  console.log("\n--- 7) Core dan mapping (sambungan ODC → ODP) ---");
  const core = await POST(
    "/api/cores",
    { source: "odc_to_odp", odc_id: odcId, odp_id: odpId, core: 1, status: "used", destination: "ODP-UJI-01B" },
    admin,
  );
  cek("tambah penugasan core → 201", core.status === 201, `status ${core.status}`);
  const coreUbah = await PATCH(`/api/cores/${core.data?.id}`, { status: "idle" }, admin);
  cek("ubah status core → 200", coreUbah.status === 200 && coreUbah.data?.status === "idle");

  const linkTanpaField = await POST("/api/links", { odc_id: odcId }, admin);
  cek("link tanpa field wajib → 400", linkTanpaField.status === 400, `status ${linkTanpaField.status}`);

  const link = await POST("/api/links", { odc_id: odcId, odc_core: 1, odp_id: odpId, odp_core: 1, notes: "Closure uji" }, admin);
  cek("sambungkan core ODC → ODP → 201", link.status === 201, `status ${link.status}`);

  const linkGandaOdc = await POST("/api/links", { odc_id: odcId, odc_core: 1, odp_id: odpId, odp_core: 2 }, admin);
  cek("core ODC yang sama dua kali → 409", linkGandaOdc.status === 409, `status ${linkGandaOdc.status}`);

  const linkGandaOdp = await POST("/api/links", { odc_id: odcId, odc_core: 2, odp_id: odpId, odp_core: 1 }, admin);
  cek("core ODP yang sama dua kali → 409", linkGandaOdp.status === 409, `status ${linkGandaOdp.status}`);

  const daftarLink = await GET("/api/links", admin);
  cek("daftar link memuat nama ODC & ODP", Array.isArray(daftarLink.data) && daftarLink.data.every((l) => "odc_name" in l && "odp_name" in l));

  const linkHapus = await DEL(`/api/links/${link.data?.id}`, admin);
  cek("hapus sambungan core → 200", linkHapus.status === 200);

  // ---------------------------------------------------- 8. User
  console.log("\n--- 8) Manajemen user ---");
  const userEmailSalah = await POST("/api/users", { email: "bukan-email", full_name: "X", password: "Rahasia123", role: "user" }, admin);
  cek("email tidak valid → 400", userEmailSalah.status === 400, `status ${userEmailSalah.status}`);
  const userPasswordPendek = await POST("/api/users", { email: "x@contoh.id", full_name: "X", password: "123", role: "user" }, admin);
  cek("password < 8 karakter → 400", userPasswordPendek.status === 400, `status ${userPasswordPendek.status}`);
  const userPeranSalah = await POST("/api/users", { email: "x@contoh.id", full_name: "X", password: "Rahasia123", role: "bos" }, admin);
  cek("peran tidak dikenal → 400", userPeranSalah.status === 400, `status ${userPeranSalah.status}`);
  const userGanda = await POST("/api/users", { email: "admin@arena.test", full_name: "Admin", password: "Rahasia123", role: "admin" }, admin);
  cek("email ganda → 409", userGanda.status === 409, `status ${userGanda.status}`);

  const turunkanDiri = await PATCH(`/api/users/${me.data?.user?.id}`, { full_name: "Admin", role: "operator" }, admin);
  cek("admin tidak bisa menurunkan peran dirinya sendiri → 400", turunkanDiri.status === 400, `status ${turunkanDiri.status}`);
  const hapusDiri = await DEL(`/api/users/${me.data?.user?.id}`, admin);
  cek("admin tidak bisa menghapus akunnya sendiri → 400", hapusDiri.status === 400, `status ${hapusDiri.status}`);

  const daftarUser = await GET("/api/users", admin);
  cek("daftar user tidak membocorkan password", Array.isArray(daftarUser.data) && daftarUser.data.every((u) => !("password_hash" in u)));

  // ---------------------------------------------------- 9. Laporan & dashboard
  console.log("\n--- 9) Dashboard dan laporan ---");
  const dash = await GET("/api/dashboard", admin);
  cek(
    "dashboard berisi hitungan (olt/odc/odp/core/splitter)",
    dash.status === 200 && ["olts", "odcs", "odps", "cores", "splitters", "links"].every((k) => typeof dash.data?.[k] === "number"),
    JSON.stringify(dash.data).slice(0, 120),
  );
  const laporan = await GET("/api/laporan", admin);
  cek("laporan → 200", laporan.status === 200, `status ${laporan.status}`);

  // ---------------------------------------------------- 10. Endpoint lain
  console.log("\n--- 10) Penjaga umum ---");
  const tidakAda = await GET("/api/tidak-ada-endpoint-ini", admin);
  cek("endpoint tidak dikenal → 404", tidakAda.status === 404, `status ${tidakAda.status}`);
  const jsonRusak = await fetch(BASE + "/api/olts", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${admin}` },
    body: "{ini bukan json",
  });
  cek("body JSON rusak tidak membuat server mati (respons error, bukan crash)", jsonRusak.status >= 400 && jsonRusak.status < 600, `status ${jsonRusak.status}`);
  const masihHidup = await GET("/healthz");
  cek("server masih hidup setelah input rusak", masihHidup.status === 200);

  // ---------------------------------------------------- 11. Logout
  console.log("\n--- 11) Logout ---");
  const loginBaru = await POST("/api/login", { email: "admin@arena.test", password: "Arena123!" });
  const keluar = await POST("/api/logout", {}, loginBaru.data?.token);
  cek("logout → 200", keluar.status === 200);
  const sesiMatl = await GET("/api/me", loginBaru.data?.token);
  cek("token setelah logout tidak berlaku → 401", sesiMatl.status === 401, `status ${sesiMatl.status}`);

  // ------------------------------------------- 12. Data alur core (tanpa redaman)
  console.log("\n--- 12) Data alur core dari server (seed demo) ---");
  const [olts, odcs, odps, splitters, links, feederPorts, cores] = await Promise.all([
    GET("/api/olts", admin),
    GET("/api/odcs", admin),
    GET("/api/odps", admin),
    GET("/api/splitters", admin),
    GET("/api/links", admin),
    GET("/api/feeder-ports", admin),
    GET("/api/cores", admin),
  ]);
  cek("semua data terbaca", [olts, odcs, odps, splitters, links, feederPorts, cores].every((r) => r.status === 200));
  cek(
    "data demo tersedia (≥2 OLT, ≥3 ODC, ODP, splitter)",
    olts.data?.length >= 2 && odcs.data?.length >= 3 && odps.data?.length >= 1 && splitters.data?.length >= 1,
    `olt=${olts.data?.length} odc=${odcs.data?.length} odp=${odps.data?.length} spl=${splitters.data?.length}`,
  );
  cek(
    "splitter demo punya output terarah (alur core bisa digambar)",
    splitters.data?.some((sp) => (sp.outputs ?? []).some((o) => o.target_type)),
  );
  cek(
    "setiap ODC tahu port feeder-nya (awal alur core)",
    feederPorts.data?.length >= 1 && feederPorts.data?.every((f) => f.olt_name && f.port != null),
    `${feederPorts.data?.length} port feeder`,
  );
  // Penjaga: perhitungan redaman/daya sudah dibuang total, termasuk dari API.
  const bocor = JSON.stringify({
    olt: olts.data, odc: odcs.data, odp: odps.data, spl: splitters.data,
    link: links.data, feeder: feederPorts.data, core: cores.data,
  }).match(/"(tx_power|rx_power|power_dbm|feeder_loss_db|loss_db)"/g);
  cek("API tidak lagi mengirim field redaman/daya", !bocor, bocor ? [...new Set(bocor)].join(", ") : "");

  // ---------------------------------------------------- ringkasan
  console.log(`\nAPI: ${lolos} lolos, ${gagal} gagal`);
  if (gagal) console.log("Yang gagal:\n - " + kegagalan.join("\n - "));
}

main()
  .catch((e) => {
    console.error("\nUJI API ERROR:", e.message);
    gagal++;
  })
  .finally(() => {
    if (server) server.kill();
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* abaikan */
    }
    process.exit(gagal ? 1 : 0);
  });
