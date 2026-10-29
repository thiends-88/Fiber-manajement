// Audit pra-deploy: server dan seluruh data uji terisolasi dari preview/produksi.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = process.env.UJI_PREDEPLOY_SOURCE || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-predeploy-"));
const DB = path.join(TMP, "network.db"), PORT = process.env.UJI_PREDEPLOY_PORT || "4792", BASE = `http://127.0.0.1:${PORT}`;
let server, output = "", token, passed = 0, failed = 0;
async function check(name, test) {
  try { await test(); passed++; console.log(`  OK    ${name}`); }
  catch (e) { failed++; console.error(`  GAGAL ${name}: ${e.message}`); }
}
async function start(extra = {}, mustFail = false) {
  server = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env: { ...process.env, NODE_ENV: "development", ARENA_API_HOST: "127.0.0.1", ARENA_API_PORT: PORT, ARENA_DB_PATH: DB, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Startup timeout: ${logs}`)), 15000);
    const done = result => { clearTimeout(timer); resolve(result); };
    server.stdout.on("data", d => { output += d; logs += d; if (logs.includes("siap di")) done({ ready: true }); });
    server.stderr.on("data", d => { output += d; logs += d; });
    server.once("error", e => { clearTimeout(timer); reject(e); });
    server.once("exit", code => { if (mustFail) done({ ready: false, code }); else { clearTimeout(timer); reject(Error(`Server berhenti ${code}: ${logs}`)); } });
  });
}
async function stop() {
  if (server && server.exitCode == null && server.signalCode == null) { const ended = once(server, "exit"); server.kill(); await ended; }
  server = null;
}
async function request(method, route, body, { auth = token, headers = {} } = {}) {
  const res = await fetch(BASE + route, { method, headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data; try { data = await res.json(); } catch { data = null; } return { res, data };
}
const call = async (method, route, body, status = method === "POST" ? 201 : 200) => {
  const {res, data} = await request(method, route, body); assert.equal(res.status, status, `${method} ${route}: ${JSON.stringify(data)}`); return data;
};
const login = async (email = "admin@arena.test", password = "Arena123!") => {
  const { res, data } = await request("POST", "/api/login", { email, password }, { auth: null }); assert.equal(res.status, 200); token = data.token; return data;
};
const dbRead = fn => { const db = new DatabaseSync(DB, { readOnly: true }); try { return fn(db); } finally { db.close(); } };
const tables = ["olts", "olt_cards", "olt_ports", "odcs", "odps", "odc_feeder_ports", "interface_mappings", "core_assignments", "core_links", "splitters", "splitter_outputs"];
const snapshot = () => dbRead(db => JSON.stringify(Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]))));
try {
  console.log("\n=== AUDIT PRA-DEPLOY API / KEAMANAN ===");
  await start(); const admin = await login();
  const own = await call("POST", "/api/users", { email: "owner@test.local", full_name: "Pemilik Produksi", password: "StrongProduction123!", role: "admin" });
  await check("token sesi pada URL tidak menjadi kanal login", async () => {
    const {res} = await request("GET", `/api/me?token=${encodeURIComponent(admin.token)}`, undefined, { auth: null }); assert.equal(res.status, 401);
  });
  await check("respons API sensitif tidak boleh disimpan proxy/browser cache", async () => {
    const {res} = await request("GET", "/api/me"); assert.match(res.headers.get("cache-control") || "", /no-store/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff"); assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  });
  await check("login dari Origin asing ditolak sebelum membuat sesi/cookie", async () => {
    const before = dbRead(db => db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n);
    const {res} = await request("POST", "/api/login", { email: "admin@arena.test", password: "Arena123!" }, {auth:null,headers:{ origin: "https://hostile.test" }});
    assert.equal(res.status, 403); assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(dbRead(db => db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n), before);
  });
  await check("permintaan tulis cross-origin memakai cookie valid tetap ditolak tanpa mutasi", async () => {
    const before = snapshot();
    const {res} = await request("POST", "/api/olts", {name:"CSRF tidak boleh tersimpan"}, {auth:null,headers:{cookie:`fiberops_token=${admin.token}`, origin:"https://hostile.test"}});
    assert.equal(res.status,403); assert.equal(snapshot(), before);
  });
  await check("Origin null dan Sec-Fetch-Site cross-site ditolak pada permintaan tulis", async () => {
    for (const headers of [{origin:"null"},{"sec-fetch-site":"cross-site"}]) assert.equal((await request("POST", "/api/olts", {name:"Tidak disimpan"}, {headers})).res.status,403);
  });
  await check("Origin dan host yang sama serta klien header/cookie normal tetap bekerja", async () => {
    const {res,data} = await request("POST", "/api/olts", {name:"OLT-ORIGIN-VALID"}, {headers:{origin:BASE}}); assert.equal(res.status,201);
    await call("DELETE",`/api/olts/${data.id}`);
    assert.equal((await request("GET","/api/me",undefined,{auth:null,headers:{cookie:`fiberops_token=${admin.token}`}})).res.status,200);
    assert.equal((await request("GET","/api/me",undefined,{auth:null,headers:{"x-fiberops-token":admin.token}})).res.status,200);
    assert.equal((await request("GET","/api/me",undefined,{auth:"invalid",headers:{"x-fiberops-token":admin.token,cookie:`fiberops_token=${admin.token}`}})).res.status,401);
  });
  await check("jenis email/password login yang tidak valid ditolak sebagai input, bukan dikonversi", async () => {
    for (const password of [["Arena123!"], {value:"Arena123!"}, true]) assert.equal((await request("POST","/api/login",{email:"admin@arena.test",password},{auth:null})).res.status,400);
  });
  await check("nama parameter token ter-encode tetap disamarkan di log", async () => {
    const marker = "AuditOnlySecretTokenMustNotAppear";
    await request("GET",`/api/me?%74oken=${marker}`,undefined,{auth:null}); await new Promise(r=>setTimeout(r,25)); assert.ok(!output.includes(marker));
  });
  // Receiver yang dihapus tidak boleh diganti otomatis oleh splitter lain saat restart.
  const olt = await call("POST","/api/olts",{name:"OLT-RESTART",olt_type:"ZTE C300"});
  const odc = suffix => call("POST","/api/odcs",{name:`ODC-RESTART-${suffix}`,olt_id:olt.id,cable_type:"figure8_6_core"});
  const parent=await odc("A"),child=await odc("B");
  const splitter=(d,name,core)=>call("POST","/api/splitters",{name,odc_id:d.id,ratio:"1:4",input_core:core});
  const source=await splitter(parent,"Sumber",1),receiver=await splitter(child,"Receiver yang dihapus",1);
  await splitter(child,"Bukan pengganti receiver",2);
  await call("PATCH",`/api/splitter-outputs/${source.outputs[0].id}`,{target_type:"odc",target_id:child.id,target_odc_splitter_id:receiver.id});
  await call("DELETE",`/api/splitters/${receiver.id}`); const beforeRestart=snapshot();
  await stop(); await start(); await login();
  await check("restart tidak menebak receiver pengganti untuk jalur ODC yang receiver-nya dihapus",async()=>{
    const saved=(await call("GET","/api/splitters")).find(s=>s.id===source.id).outputs[0];
    assert.equal(saved.target_odc_id,child.id); assert.equal(saved.target_odc_splitter_id,null); assert.equal(snapshot(),beforeRestart);
  });
  await check("HTML produksi tidak disimpan dengan cache usang, aset tidak membuka file privat",async()=>{
    const res=await fetch(BASE+"/dashboard");assert.equal(res.status,200);assert.match(res.headers.get("cache-control")||"",/no-store/);
    for(const route of ["/.git/config","/server.mjs","/data/fiberops.db","/%2e%2e/server.mjs"]){const body=await(await fetch(BASE+route)).text();assert.ok(!body.includes("import http from")&&!body.startsWith("SQLite format 3"));}
  });
  await check("worker PDF .mjs dilayani dengan MIME JavaScript dan cache aset immutable",async()=>{
    const dir=path.join(ROOT,"dist","assets"), worker=fs.readdirSync(dir).find(n=>n.startsWith("pdf.worker")&&n.endsWith(".mjs"));assert.ok(worker);
    const response=await fetch(BASE+"/assets/"+worker);assert.match(response.headers.get("content-type")||"",/javascript/);assert.match(response.headers.get("cache-control")||"",/immutable/);await response.arrayBuffer();
  });
  await check("error SQLite internal tidak membocorkan detail privat ke respons klien",async()=>{
    const db=new DatabaseSync(DB);db.exec("CREATE TRIGGER private_error BEFORE INSERT ON olts BEGIN SELECT RAISE(ABORT,'PrivateImplementationDetail'); END");
    try{const {res,data}=await request("POST","/api/olts",{name:"Tidak boleh tersimpan"});assert.equal(res.status,500);assert.ok(!JSON.stringify(data).includes("PrivateImplementationDetail"));}
    finally{db.exec("DROP TRIGGER private_error");db.close();}
  });
  await check("Host rusak menghasilkan 400 dan tidak mematikan proses server",async()=>{
    const status = await new Promise(resolve => {
      const req = http.request({ hostname: "127.0.0.1", port: PORT, path: "/healthz", headers: { Host: "[" } }, res => { res.resume(); resolve(res.statusCode); });
      req.on("error", () => resolve(null)); req.setTimeout(5000, () => { req.destroy(); resolve(null); }); req.end();
    });
    assert.equal(status,400);assert.equal((await fetch(BASE+"/healthz")).status,200);
  });
  // Start ulang juga bila baseline crash, agar bukti temuan lain tetap terkumpul.
  await stop(); await start({NODE_ENV:"production",ARENA_SECURE_COOKIES:"1"}); await login("owner@test.local","StrongProduction123!");
  await check("cookie sesi dan logout mode HTTPS diberi Secure",async()=>{
    const {res,data}=await request("POST","/api/login",{email:own.email,password:"StrongProduction123!"},{auth:null});assert.equal(res.status,200);assert.match(res.headers.get("set-cookie")||"",/; Secure(?:;|$)/);
    const logout=await request("POST","/api/logout",undefined,{auth:data.token});assert.match(logout.res.headers.get("set-cookie")||"",/; Secure(?:;|$)/);
  });
  await check("sesi lama akun berpassword pabrik ikut ditolak saat mode production",async()=>{
    assert.equal((await request("GET","/api/me",undefined,{auth:admin.token})).res.status,401);
  });
  await check("password pabrik yang diketahui umum tidak dapat dipakai login produksi",async()=>{
    assert.equal((await request("POST","/api/login",{email:"admin@arena.test",password:"Arena123!"},{auth:null})).res.status,401);
    assert.equal((await request("POST","/api/login",{email:"operator@arena.test",password:"Arena123!"},{auth:null})).res.status,401);
  });
  await check("izin admin/operator/user tetap ditegakkan di API produksi",async()=>{
    const reader=await call("POST","/api/users",{email:"reader@test.local",full_name:"Pembaca",password:"ReaderStrong123!",role:"user"});
    const {data}=await request("POST","/api/login",{email:reader.email,password:"ReaderStrong123!"},{auth:null});
    assert.equal((await request("GET","/api/dashboard",undefined,{auth:data.token})).res.status,200);
    assert.equal((await request("POST","/api/olts",{name:"Tidak diizinkan"},{auth:data.token})).res.status,403);
    assert.equal((await request("GET","/api/users",undefined,{auth:data.token})).res.status,403);
    await call("POST","/api/users",{email:"operator-private@test.local",full_name:"Operator pribadi",password:"OperatorPribadi123!",role:"operator"});
    const operator=(await request("POST","/api/login",{email:"operator-private@test.local",password:"OperatorPribadi123!"},{auth:null})).data;
    assert.equal((await request("GET","/api/dashboard",undefined,{auth:operator.token})).res.status,200);
    const created=await request("POST","/api/olts",{name:"Sementara uji izin operator"},{auth:operator.token});assert.equal(created.res.status,201);
    assert.equal((await request("DELETE",`/api/olts/${created.data.id}`,undefined,{auth:operator.token})).res.status,200);
    assert.equal((await request("GET","/api/users",undefined,{auth:operator.token})).res.status,403);
  });
  await check("percobaan login beruntun dibatasi dan header IP palsu tidak melewatinya",async()=>{
    let last;for(let i=0;i<35;i++)last=(await request("POST","/api/login",{email:"missing@test.local",password:"wrong"},{auth:null,headers:{"x-forwarded-for":`198.51.100.${i+1}`}})).res;
    assert.equal(last.status,429);assert.ok(Number(last.headers.get("retry-after"))>0);assert.equal((await request("GET","/api/dashboard")).res.status,200);
  });
  await check("proxy tepercaya memakai X-Real-IP valid tanpa menggabungkan kuota klien yang berbeda",async()=>{
    await stop();await start({NODE_ENV:"production",ARENA_TRUSTED_PROXY_IPS:"127.0.0.1"});
    for(let i=0;i<30;i++)await request("POST","/api/login",{email:"wrong@test.local",password:"bad"},{auth:null,headers:{"x-real-ip":"198.51.100.1"}});
    assert.equal((await request("POST","/api/login",{email:"wrong@test.local",password:"bad"},{auth:null,headers:{"x-real-ip":"198.51.100.1","x-forwarded-for":"198.51.100.3"}})).res.status,429);
    const {res,data}=await request("POST","/api/login",{email:"owner@test.local",password:"StrongProduction123!"},{auth:null,headers:{"x-real-ip":"198.51.100.2"}});assert.equal(res.status,200);token=data.token;
  });
  await check("pemeriksaan SQLite tetap utuh setelah mutasi dan restart uji",()=>dbRead(db=>{
    assert.equal(db.prepare("PRAGMA quick_check").get().quick_check,"ok");assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  }));
  await check("startup mempertahankan kolom pengukuran/catatan lama, nilai dan seluruh ID inventaris",async()=>{
    await call("POST","/api/cores",{source:"olt_to_odc",odc_id:parent.id,core:6,status:"reserved"});await stop();
    const db=new DatabaseSync(DB);db.exec(`ALTER TABLE core_assignments ADD COLUMN power_dbm REAL; ALTER TABLE odcs ADD COLUMN feeder_loss_db REAL;
      ALTER TABLE olt_ports ADD COLUMN tx_power REAL; ALTER TABLE olt_ports ADD COLUMN rx_power REAL; ALTER TABLE core_links ADD COLUMN loss_db REAL;
      UPDATE core_assignments SET power_dbm=-17.4; UPDATE odcs SET feeder_loss_db=0.55; UPDATE olt_ports SET tx_power=3.5,rx_power=-11.2; UPDATE core_links SET loss_db=0.1;
      UPDATE splitters SET input_core=6,input_note='Catatan lapangan lama dipertahankan' WHERE id IN (SELECT target_splitter_id FROM splitter_outputs WHERE target_type='splitter');`);db.close();
    const before=snapshot();await start({NODE_ENV:"production"});assert.equal(snapshot(),before);await login("owner@test.local","StrongProduction123!");
    for(const route of ["/api/ports","/api/odcs","/api/cores","/api/links"]){const {res,data}=await request("GET",route);assert.equal(res.status,200);assert.ok(!/"(tx_power|rx_power|power_dbm|feeder_loss_db|loss_db)"/.test(JSON.stringify(data)));}
    await stop();await start({NODE_ENV:"production"});assert.equal(snapshot(),before);
  });
  await stop();
  await check("sesi pra-perbaikan dirotasi sekali tanpa mengubah inventaris atau mengeluarkan sesi baru setiap restart",async()=>{
    const legacyToken="LegacyAuditSessionTokenOnly";
    const db=new DatabaseSync(DB);db.prepare("DELETE FROM security_migrations WHERE id=?").run("header-only-sessions-v1");db.prepare("INSERT INTO sessions (token,user_id) VALUES (?,?)").run(legacyToken,own.id);db.close();
    const before=snapshot();await start({NODE_ENV:"production"});assert.equal((await request("GET","/api/me",undefined,{auth:legacyToken})).res.status,401);assert.equal(snapshot(),before);
    const session=await login("owner@test.local","StrongProduction123!");await stop();await start({NODE_ENV:"production"});assert.equal((await request("GET","/api/me",undefined,{auth:session.token})).res.status,200);
  });
  await check("database produksi kosong tidak diisi akun dan inventaris demo secara otomatis",async()=>{
    await stop();const empty=path.join(TMP,"fresh-production.db");const started=await start({NODE_ENV:"production",ARENA_DB_PATH:empty},true);
    assert.equal(started.ready,false);assert.notEqual(started.code,0);
    if (fs.existsSync(empty)) { const db=new DatabaseSync(empty,{readOnly:true});try{assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n,0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM olts").get().n,0);}finally{db.close();} }
  });
  await check("file DB produksi yang ada tetapi tanpa user tidak di-seed demo",async()=>{
    await stop();const empty=path.join(TMP,"existing-empty.db");new DatabaseSync(empty).close();const result=await start({NODE_ENV:"production",ARENA_DB_PATH:empty},true);assert.equal(result.ready,false);assert.notEqual(result.code,0);
    const db=new DatabaseSync(empty,{readOnly:true});try{assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n,0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM olts").get().n,0);}finally{db.close();}
  });
  console.log(`\nPRA-DEPLOY API: ${passed} lulus, ${failed} gagal.\n`);if(failed)process.exitCode=1;
} finally {await stop();fs.rmSync(TMP,{recursive:true,force:true});}
