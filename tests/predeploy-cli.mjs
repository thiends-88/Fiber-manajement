import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, verifyPassword } from "../server/security.mjs";
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),TMP=fs.mkdtempSync(path.join(os.tmpdir(),"fiber-preflight-cli-"));
const DB=path.join(TMP,"data","fresh.db"),PORT=process.env.UJI_PREFLIGHT_CLI_PORT||"4791",BASE=`http://127.0.0.1:${PORT}`;
const email="owner@secure.test",password="PribadiΣ🙂Rahasia123!";
let passed=0,server,ownerSession;
const run=(script,args=[],input="",db=DB,cwd=ROOT)=>spawnSync(process.execPath,[script,...args],{cwd,env:{...process.env,ARENA_DB_PATH:db},input,encoding:"utf8"});
const check=async(name,test)=>{await test();passed++;console.log(`  OK    ${name}`);};
const withDb=(fn,readOnly=false)=>{const db=new DatabaseSync(DB,{readOnly});try{return fn(db);}finally{db.close();}};
const snapshot=()=>withDb(db=>JSON.stringify(Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare(`SELECT * FROM ${name}`).all()]))),true);
async function start(cwd=ROOT){
  let output="";server=spawn(process.execPath,["server.mjs"],{cwd,env:{...process.env,NODE_ENV:"production",ARENA_API_HOST:"127.0.0.1",ARENA_API_PORT:PORT,ARENA_DB_PATH:DB},stdio:["ignore","pipe","pipe"]});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(output)),15000);server.stdout.on("data",d=>{output+=d;if(output.includes("siap di")){clearTimeout(timer);resolve();}});server.stderr.on("data",d=>{output+=d;});server.once("error",e=>{clearTimeout(timer);reject(e);});server.once("exit",code=>{clearTimeout(timer);reject(Error(`Server ${code}: ${output}`));});});
}
async function stop(){if(server&&server.exitCode==null&&server.signalCode==null){const done=once(server,"exit");server.kill();await done;}server=null;}
try{
  console.log("\n=== UJI PREFLIGHT / BOOTSTRAP / RUNTIME PRODUKSI ===");
  await check("preflight pada path salah gagal tanpa membuat file database atau demo",()=>{
    const absent=path.join(TMP,"does-not-exist.db"),result=run("scripts/preflight.mjs",[absent],"",absent);
    assert.equal(result.status,1);assert.ok(!fs.existsSync(absent));
  });
  await check("bootstrap menolak password pendek dan tidak membuat DB sebelum input sah",()=>{
    const result=run("scripts/create-admin.mjs",[email],"short");assert.equal(result.status,1);assert.ok(!fs.existsSync(DB));
  });
  await check("bootstrap dari stdin mempertahankan Unicode, membuat satu admin dan hash bersalt",()=>{
    const result=run("scripts/create-admin.mjs",[email],password);assert.equal(result.status,0,result.stderr);assert.ok(!result.stdout.includes(password));
    withDb(db=>{const rows=db.prepare("SELECT * FROM users").all();assert.equal(rows.length,1);assert.equal(rows[0].role,"admin");assert.ok(verifyPassword(password,rows[0].password_hash));});
  });
  await check("bootstrap tidak menimpa akun/password yang sudah ada",()=>{
    const before=snapshot(),result=run("scripts/create-admin.mjs",[email],"PasswordBerbeda123!");assert.equal(result.status,1);assert.equal(snapshot(),before);
  });
  // Tirukan tepat daftar file COPY runtime Docker, tanpa node_modules.
  const runtime=path.join(TMP,"runtime");fs.mkdirSync(runtime);
  const docker=fs.readFileSync(path.join(ROOT,"Dockerfile"),"utf8");
  for(const match of docker.matchAll(/^COPY --from=build \/app\/(.+?) +\.?\/(.*)$/gm)){
    const from=match[1].trim(),to=(match[2].trim()||path.basename(from)).replace(/^\.\//,"");
    fs.mkdirSync(path.dirname(path.join(runtime,to)),{recursive:true});fs.cpSync(path.join(ROOT,from),path.join(runtime,to),{recursive:true});
  }
  assert.ok(docker.includes("ENV NODE_ENV=production"));assert.ok(docker.includes("USER node"));
  await check("produksi tanpa build gagal sebelum menyentuh schema/database yang sudah ada",()=>{
    const built=path.join(runtime,"dist"),saved=path.join(TMP,"dist-saved");fs.renameSync(built,saved);const before=snapshot();
    try{const result=spawnSync(process.execPath,["server.mjs"],{cwd:runtime,env:{...process.env,NODE_ENV:"production",ARENA_DB_PATH:DB},timeout:5000,encoding:"utf8"});assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.match(result.stderr,/dist|build/i);assert.equal(snapshot(),before);}
    finally{fs.renameSync(saved,built);}
  });
  await start(runtime);
  await check("layout runtime Docker berjalan dalam mode production tanpa dependensi npm atau demo",async()=>{
    assert.ok(!fs.existsSync(path.join(runtime,"node_modules")));assert.equal((await fetch(BASE+"/healthz")).status,200);
    const res=await fetch(BASE+"/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});assert.equal(res.status,200);
    const {token}=await res.json();ownerSession=token;const data=await(await fetch(BASE+"/api/dashboard",{headers:{authorization:`Bearer ${token}`}})).json();assert.equal(data.olts,0);assert.deepEqual(data.oltDevices,[]);
    withDb(db=>assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n,1),true);
  });
  await check("preflight lulus pada DB produksi sehat dan tidak memodifikasi schema, sesi atau isi data",()=>{
    const before=snapshot(),result=run("scripts/preflight.mjs",[DB],"",DB,runtime);assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/0 penghalang/);assert.equal(snapshot(),before);
  });
  await check("rotasi password lokal mempertahankan ID/role, mencabut sesi lama dan tidak mencetak rahasia",async()=>{
    const identity=withDb(db=>db.prepare("SELECT id,email,full_name,role,created_at FROM users WHERE email=?").get(email),true),rotated="PasswordBaruTeruji123!";
    const result=run("scripts/set-password.mjs",[email],rotated);assert.equal(result.status,0,result.stderr);assert.ok(!result.stdout.includes(rotated));
    withDb(db=>{assert.deepEqual(db.prepare("SELECT id,email,full_name,role,created_at FROM users WHERE email=?").get(email),identity);const u=db.prepare("SELECT * FROM users WHERE email=?").get(email);assert.ok(verifyPassword(rotated,u.password_hash));assert.ok(!verifyPassword(password,u.password_hash));},true);
    assert.equal((await fetch(BASE+"/api/me",{headers:{authorization:`Bearer ${ownerSession}`}})).status,401);
    assert.equal((await fetch(BASE+"/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password:rotated})})).status,200);
  });
  await check("rotasi email yang salah tidak membuat akun/DB baru atau mengubah data",()=>{
    const before=snapshot();assert.equal(run("scripts/set-password.mjs",["missing@test.local"],"PasswordCukupPanjang123!").status,1);assert.equal(snapshot(),before);
    const missing=path.join(TMP,"missing-rotate.db");assert.equal(run("scripts/set-password.mjs",[email],"PasswordCukupPanjang123!",missing).status,1);assert.ok(!fs.existsSync(missing));
  });
  await check("preflight mendeteksi password pabrik tanpa menampilkan password/hash",()=>{
    withDb(db=>db.prepare("INSERT INTO users (email,password_hash,full_name,role) VALUES (?,?,?,'operator')").run("factory@test.local",hashPassword("Arena123!"),"Akun belum aman"));
    try{const result=run("scripts/preflight.mjs",[DB]);assert.equal(result.status,1);assert.match(result.stdout,/password pabrik/);assert.ok(!result.stdout.includes("Arena123!"));assert.ok(!result.stdout.includes("scrypt$"));}
    finally{withDb(db=>db.prepare("DELETE FROM users WHERE email=?").run("factory@test.local"));}
  });
  await check("hash admin rusak tidak dianggap sebagai akun produksi yang dapat dipakai",()=>{
    const original=withDb(db=>db.prepare("SELECT password_hash FROM users WHERE email=?").get(email).password_hash,true);
    withDb(db=>db.prepare("UPDATE users SET password_hash='broken-hash' WHERE email=?").run(email));
    try{const before=snapshot(),result=run("scripts/preflight.mjs",[DB]);assert.equal(result.status,1);assert.match(result.stdout,/hash password tidak didukung/);assert.equal(snapshot(),before);}
    finally{withDb(db=>db.prepare("UPDATE users SET password_hash=? WHERE email=?").run(original,email));}
  });
  await check("preflight mendeteksi posisi card lama ganda sebelum unique-index migration",()=>{
    withDb(db=>{db.exec("DROP INDEX uq_card_position");const olt=db.prepare("INSERT INTO olts (name) VALUES ('OLT-DUP')").run().lastInsertRowid;const ins=db.prepare("INSERT INTO olt_cards (olt_id,slot,card_type,port_count) VALUES (?,1,'GTGO',8)");ins.run(olt);ins.run(olt);});
    const before=snapshot(),result=run("scripts/preflight.mjs",[DB]);assert.equal(result.status,1);assert.match(result.stdout,/posisi card ganda/);assert.equal(snapshot(),before);
    withDb(db=>{db.exec("DELETE FROM olt_cards; DELETE FROM olts; CREATE UNIQUE INDEX uq_card_position ON olt_cards(olt_id,shelf,slot)");});
  });
  await check("preflight melaporkan FK/capacity bermasalah tanpa merapikan/menghapus ID otomatis",()=>{
    withDb(db=>{db.exec("PRAGMA foreign_keys=OFF");db.prepare("INSERT INTO olt_ports (card_id,port) VALUES (99999,33)").run();});
    const before=snapshot(),result=run("scripts/preflight.mjs",[DB]);assert.equal(result.status,1);assert.match(result.stdout,/foreign key/);assert.equal(snapshot(),before);
    withDb(db=>db.prepare("DELETE FROM olt_ports WHERE card_id=99999").run());
  });
  await stop();
  await check("migrasi feeder lama menyalin hanya referensi eksplisit dan mempertahankan ID",async()=>{
    withDb(db=>{db.exec("ALTER TABLE odcs ADD COLUMN feeder_port_id INTEGER REFERENCES olt_ports(id) ON DELETE SET NULL; DROP TABLE interface_mappings; DROP TABLE odc_feeder_ports");
      const olt=db.prepare("INSERT INTO olts (name) VALUES ('OLT-LEGACY')").run().lastInsertRowid;
      const card=db.prepare("INSERT INTO olt_cards (olt_id,slot,card_type,port_count) VALUES (?,1,'GTGO',8)").run(olt).lastInsertRowid;
      const port=db.prepare("INSERT INTO olt_ports (card_id,port) VALUES (?,1)").run(card).lastInsertRowid;
      db.prepare("INSERT INTO odcs (name,olt_id,cable_type,feeder_port_id) VALUES ('ODC-LEGACY',?,'figure8_6_core',?)").run(olt,port);
    });
    const before=withDb(db=>db.prepare("SELECT * FROM odcs").all(),true);await start();
    withDb(db=>{assert.deepEqual(db.prepare("SELECT * FROM odcs").all(),before);const f=db.prepare("SELECT * FROM odc_feeder_ports").get();assert.equal(f.odc_id,before[0].id);assert.equal(f.port_id,before[0].feeder_port_id);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM interface_mappings").get().n,0);},true);await stop();
  });
  await check("migrasi feeder rusak gagal tertutup dan di-rollback, bukan ditelan lalu hilang saat restart",()=>{
    withDb(db=>{db.exec("PRAGMA foreign_keys=OFF; DROP TABLE interface_mappings; DROP TABLE odc_feeder_ports; UPDATE odcs SET feeder_port_id=99999");});const before=snapshot();
    for(let i=0;i<2;i++){
      const result=spawnSync(process.execPath,["server.mjs"],{cwd:ROOT,env:{...process.env,NODE_ENV:"production",ARENA_API_PORT:PORT,ARENA_DB_PATH:DB},timeout:5000,encoding:"utf8"});
      assert.equal(result.error,undefined,"Server semestinya gagal sebelum listen, bukan berjalan tanpa feeder");assert.notEqual(result.status,0);assert.equal(snapshot(),before);
      withDb(db=>assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='odc_feeder_ports'").get(),undefined),true);
    }
  });
  await check("backup SQLite menyertakan transaksi WAL; salinan db saja memang tidak cukup",()=>{
    const active=path.join(TMP,"wal-source.db"),backup=path.join(TMP,"consistent-backup.db"),unsafe=path.join(TMP,"copy-main-only.db");
    const db=new DatabaseSync(active);try{
      db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE evidence (id INTEGER PRIMARY KEY, note TEXT); PRAGMA wal_checkpoint(TRUNCATE)");
      db.prepare("INSERT INTO evidence (note) VALUES (?)").run("Data yang baru ada dalam WAL");fs.copyFileSync(active,unsafe);
      const result=run("scripts/backup.mjs",[active,backup]);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/quick_check=ok/);
      const repeat=run("scripts/backup.mjs",[active,backup]);assert.equal(repeat.status,1,"Backup lama tidak ditimpa");
      const wrong=new DatabaseSync(unsafe,{readOnly:true});try{assert.equal(wrong.prepare("SELECT COUNT(*) AS n FROM evidence").get().n,0);}finally{wrong.close();}
      const good=new DatabaseSync(backup,{readOnly:true});try{assert.equal(good.prepare("SELECT COUNT(*) AS n FROM evidence").get().n,1);}finally{good.close();}
    }finally{db.close();}
  });
  console.log(`\nPREFLIGHT CLI: ${passed} pemeriksaan lulus.\n`);
}finally{await stop();fs.rmSync(TMP,{recursive:true,force:true});}
