// Uji upgrade nyata pada repo/remote Git LOKAL dan DB SINTETIS sementara.
// systemctl dimock; npm ci/build nyata pada legacy-upgrade, dimock pada kasus lain.
// Tidak membaca DB pengguna, mengakses service nyata, push, atau berpindah branch workspace.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { snapshot, compare } from "../scripts/check-existing-update.mjs";
import { existingUpdateData, accounts, factoryPassword } from "./fixtures/existing-update-data.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OLD = process.env.FIBEROPS_TEST_OLD_REF || "8e8aada04b1c44a57dcc5b325e1076db0a331562";
const MERGED = process.env.FIBEROPS_TEST_MERGED_REF || "22f1dfef0e5e67e15ad6f8c78fe80dd8fff805c0";
if (process.getuid() !== 0) {
  const result = spawnSync("sudo", ["-n", "env", ...["FIBEROPS_TEST_ONLY", "FIBEROPS_TEST_FAST", "FIBEROPS_KEEP_UPGRADE_FIXTURES", "FIBEROPS_TEST_OLD_REF", "FIBEROPS_TEST_MERGED_REF"].filter(key => process.env[key]).map(key => `${key}=${process.env[key]}`), process.execPath, import.meta.filename], { stdio: "inherit" });
  process.exit(result.status ?? 2);
}
// Anak UID service tidak mewarisi supplementary group root dari runner.
process.setgroups([]);
const uid = Number(fs.statSync(ROOT).uid), gid = Number(fs.statSync(ROOT).gid);
const user = spawnSync("getent", ["passwd", String(uid)], { encoding: "utf8" }).stdout.split(":")[0];
const group = spawnSync("getent", ["group", String(gid)], { encoding: "utf8" }).stdout.split(":")[0];
assert.ok(user && group && uid !== 0, "Fixture memerlukan pemilik checkout non-root untuk menguji UID berbeda");
function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60000, maxBuffer: 24 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command} ${args.slice(0, 3).join(" ")}: ${result.stderr || result.error || result.stdout}`);
  return result.stdout?.trim();
}
function asUser(command, args, options = {}) {
  return run("/usr/sbin/runuser", ["-u", user, "-g", group, "--", command, ...args], options);
}
for (const ref of [OLD, MERGED]) run("git", ["-C", ROOT, "cat-file", "-e", `${ref}^{commit}`], { env: { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: ROOT } });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-preserve-update-"));
fs.chmodSync(TMP, 0o755);
const BIN = path.join(TMP, "bin");
fs.mkdirSync(BIN, { mode: 0o755 });
fs.copyFileSync(process.execPath, path.join(BIN, "node"));
fs.chmodSync(path.join(BIN, "node"), 0o755);
const NODE = path.join(BIN, "node"), realNpm = run("which", ["npm"]);
const gitEnv = { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: ROOT };
const branchBefore = run("git", ["-C", ROOT, "branch", "--show-current"], { env: gitEnv });
let current, extra, passed = 0, realNpmRan = false;
const background = new Set();
function stub(name, source) {
  fs.writeFileSync(path.join(BIN, name), `#!/usr/bin/env node\n${source}\n`, { mode: 0o755 });
}
stub("npm", String.raw`
const fs=require('fs'),cp=require('child_process'),state=JSON.parse(fs.readFileSync(process.env.MOCK_EXISTING_STATE,'utf8')),args=process.argv.slice(2);
fs.appendFileSync(state.npmLog,JSON.stringify(args)+'\n');
if(state.scenario==='build-fail'&&args[0]==='run')process.exit(42);
if(!((args[0]==='ci'&&args.includes('--include=dev'))||(args[0]==='run'&&args[1]==='build')))process.exit(90);
if(state.realNpm){const result=cp.spawnSync(state.realNpm,args,{stdio:'inherit',env:process.env});process.exit(result.status??1);}
fs.mkdirSync(state.app+'/dist',{recursive:true});fs.writeFileSync(state.app+'/dist/index.html','<!doctype html><title>isolated fast fixture</title>');
`);
stub("systemctl", String.raw`
const fs=require('fs'),cp=require('child_process'),file=process.env.MOCK_EXISTING_STATE,args=process.argv.slice(2);let state=JSON.parse(fs.readFileSync(file,'utf8'));
function save(){fs.writeFileSync(file,JSON.stringify(state));}
function alive(){if(!state.pid)return false;try{return !fs.readFileSync('/proc/'+state.pid+'/stat','utf8').includes(') Z');}catch{return false;}}
(async()=>{
 if(args[0]==='is-active'){process.exit(alive()?0:3);}
 if(args[0]==='show'){
   if(args.includes('DynamicUser')){console.log(state.scenario==='dynamic'?'yes':'no');return;}
   state.pidShows=(state.pidShows||0)+1;save();
   console.log(state.scenario==='pid-drift'&&state.pidShows===2?state.pid+100000:(alive()?state.pid:0));return;
 }
 if(args[0]==='cat'){console.log('[Service]\nUser='+state.user+'\nWorkingDirectory='+state.app+'\nExecStart='+state.node+' '+state.app+'/server.mjs');return;}
 if(args[0]==='stop'){
   state.stops++;if(state.scenario==='stop-fail'){save();process.exit(44);}if(alive()){process.kill(state.pid,'SIGTERM');for(let n=0;n<80&&alive();n++)await new Promise(resolve=>setTimeout(resolve,40));}
   if(alive())throw Error('Fixture failed to stop');state.pid=0;save();return;
 }
 if(args[0]==='start'){
   state.starts++;save();if(state.scenario==='start-fail')process.exit(43);
   if(state.scenario==='live-drift'){const{DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(state.db);db.prepare("UPDATE odcs SET notes='DRIFT SINTETIS SAAT LIVE' WHERE id=1001").run();db.close();}
   const env={...state.profile};if(state.scenario==='env-drift')env.NODE_ENV='production';
   const fd=fs.openSync(state.appLog,'a');const child=cp.spawn(state.node,[state.app+'/server.mjs'],{cwd:state.app,env,uid:state.uid,gid:state.gid,detached:true,stdio:['ignore',fd,fd]});
   fs.closeSync(fd);child.unref();state.pid=child.pid;state.pids.push(child.pid);save();return;
 }
 throw Error('Unexpected systemctl: '+args.join(' '));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
`);
function git(args, cwd, options = {}) { return asUser("git", args, { cwd, ...options }); }
function archive(ref, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const result = spawnSync("git", ["-C", ROOT, "archive", ref], { env: gitEnv, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  run("tar", ["-xf", "-", "-C", destination], { input: result.stdout });
}
function own(folder) { run("chown", ["-R", `${uid}:${gid}`, folder]); }
function repository(label, base, backupFailure = false) {
  const dir = path.join(TMP, label), repo = path.join(dir, "source"), remote = path.join(dir, "origin.git");
  fs.mkdirSync(dir, { mode: 0o755 });
  archive(base, repo);
  own(repo);
  git(["init", "-b", "main"], repo);
  git(["config", "user.email", "fixture@upgrade.test"], repo);
  git(["config", "user.name", "Temporary upgrade fixture"], repo);
  git(["config", "core.hooksPath", "/dev/null"], repo);
  git(["add", "-A"], repo);
  git(["commit", "-qm", `Synthetic baseline ${base}`], repo);
  const before = git(["rev-parse", "HEAD"], repo);
  archive(MERGED, repo);
  // Kandidat selalu memakai kode aplikasi WORKSPACE saat ini, bukan membekukan
  // pengujian selamanya di commit PR #10. Pada audit awal kode aplikasi identik
  // 22f1dfe; edit aplikasi di masa depan otomatis ikut diuji oleh harness ini.
  for (const folder of ["src", "server", "scripts", "tests"]) {
    fs.rmSync(path.join(repo, folder), { recursive: true, force: true });
    fs.cpSync(path.join(ROOT, folder), path.join(repo, folder), { recursive: true });
  }
  for (const file of ["server.mjs", "package.json", "package-lock.json", "index.html", "vite.config.js", ".gitignore"]) fs.copyFileSync(path.join(ROOT, file), path.join(repo, file));
  if (backupFailure) fs.writeFileSync(path.join(repo, "scripts/backup.mjs"), "process.exit(73);\n");
  own(repo);
  git(["add", "-A"], repo);
  git(["commit", "-qm", `Application ${MERGED}; tested existing-update support`], repo);
  const target = git(["rev-parse", "HEAD"], repo);
  fs.mkdirSync(remote);fs.chownSync(remote, uid, gid);
  asUser("git", ["clone", "--bare", repo, remote]);
  return { before, target, remote, base, repo };
}
async function freePort() {
  const server = net.createServer();server.listen(0, "127.0.0.1");await once(server, "listening");
  const port = server.address().port;await new Promise(resolve => server.close(resolve));return port;
}
function alive(pid) { try { return !fs.readFileSync(`/proc/${pid}/stat`, "utf8").includes(") Z"); } catch { return false; } }
async function terminate(pid) {
  if (!pid || !alive(pid)) return;
  process.kill(pid, "SIGTERM");
  for (let n = 0; n < 80 && alive(pid); n++) await new Promise(resolve => setTimeout(resolve, 40));
  if (alive(pid)) { process.kill(pid, "SIGKILL"); throw Error(`Fixture PID ${pid} tidak berhenti normal`); }
}
async function ready(port, pid) {
  for (let n = 0; n < 100; n++) {
    if (!alive(pid)) throw Error("Fixture app exited before health");
    try { const result = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) });if ((await result.json()).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw Error("Fixture app not ready");
}
function sql(file, fn) { const db = new DatabaseSync(file);try { return fn(db); } finally { db.close(); } }
async function fixture(scenario, origin, { model = "ZTE C300", modern = false, production = false, factory = true } = {}) {
  const dir = path.join(TMP, `case-${scenario}`), app = path.join(dir, "app"), storage = path.join(dir, "storage with spaces");
  fs.mkdirSync(dir, { mode: 0o755 });
  fs.mkdirSync(app);fs.chownSync(app, uid, gid);
  asUser("git", ["clone", "--no-checkout", "--branch", "main", origin.remote, app]);
  git(["update-ref", "refs/heads/main", origin.before], app);
  git(["read-tree", "--reset", "-u", "HEAD"], app);
  fs.mkdirSync(path.join(app, "dist"));fs.writeFileSync(path.join(app, "dist/index.html"), "<!doctype html><title>Before upgrade fixture</title>");own(path.join(app, "dist"));
  fs.mkdirSync(storage, { mode: 0o700 });fs.chownSync(storage, uid, gid);
  const db = path.join(storage, "existing database.db"), port = await freePort();
  const ownerPassword = `PrivateFixture-${crypto.randomUUID()}`, secret = `DoNotPrint-${crypto.randomUUID()}`;
  const profile = { PATH: `${BIN}:${process.env.PATH}`, HOME: process.env.SUDO_USER ? `/home/${process.env.SUDO_USER}` : os.homedir(), ARENA_DB_PATH: db, ARENA_API_HOST: scenario === "legacy-upgrade" ? "0.0.0.0" : "127.0.0.1", ARENA_API_PORT: String(port), ARENA_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, ARENA_SECURE_COOKIES: "0", ARENA_UNUSED_TEST_SECRET: secret };
  if (production) profile.NODE_ENV = "production";
  asUser(NODE, ["scripts/create-admin.mjs", accounts.owner], { cwd: app, env: profile, input: ownerPassword });
  const appLog = path.join(dir, "app.log");
  async function start() {
    const fd = fs.openSync(appLog, "a");
    const child = spawn(NODE, [path.join(app, "server.mjs")], { cwd: app, env: profile, uid, gid, stdio: ["ignore", fd, fd] });
    fs.closeSync(fd);background.add(child);
    await ready(port, child.pid);return child;
  }
  let child = await start();await terminate(child.pid);
  const counts = existingUpdateData(db, { model, ownerPassword, factory, modern });
  child = await start();
  // Perubahan berikut hanya menyusun skenario kerusakan/warisan pada DB sementara.
  sql(db, connection => {
    if (scenario === "bad-hash") connection.prepare("UPDATE users SET password_hash='UNSUPPORTED' WHERE id=509").run();
    if (scenario === "bad-capacity") connection.prepare("UPDATE olt_ports SET port=99 WHERE id=2001").run();
    if (scenario === "missing-odp-splitter") { connection.exec("PRAGMA foreign_keys=ON; DELETE FROM splitters WHERE id=9102"); }
    if (["probe-drift", "probe-fail"].includes(scenario)) {
      connection.exec("ALTER TABLE olts ADD COLUMN latitude REAL; ALTER TABLE olts ADD COLUMN longitude REAL; UPDATE olts SET latitude=-0.79,longitude=100.64");
      connection.exec(scenario === "probe-drift"
        ? "CREATE TRIGGER fixture_drift AFTER UPDATE ON olts BEGIN UPDATE olts SET notes='DRIFT DALAM SALINAN' WHERE id=NEW.id; END"
        : "CREATE TRIGGER fixture_abort BEFORE UPDATE ON olts BEGIN SELECT RAISE(ABORT,'FIXTURE_MIGRATION_ABORT'); END");
    }
    if (scenario === "security-session-migration") connection.exec("DELETE FROM security_migrations; INSERT INTO sessions(token,user_id) SELECT 'fixture-session-to-revoke',id FROM users WHERE role='admin' LIMIT 1");
    connection.exec('UPDATE field_records SET "catatan petugas"="catatan petugas" || \' / WAL committed\'');
  });
  // Menyerupai peringatan instalasi existing: izin longgar dicatat, bukan diubah updater.
  if (scenario === "legacy-upgrade") { fs.chmodSync(storage, 0o755);fs.chmodSync(db, 0o644); }
  if (scenario === "dirty") fs.appendFileSync(path.join(app, "README.md"), "\nLocal fixture change — must not overwrite\n");
  if (scenario === "fetch-fail") git(["remote", "set-url", "origin", path.join(TMP, "missing-origin.git")], app);
  const stateFile = path.join(dir, "state.json"), npmLog = path.join(dir, "npm.log");
  fs.writeFileSync(npmLog, "");fs.chownSync(npmLog, uid, gid);
  fs.writeFileSync(stateFile, JSON.stringify({ scenario, app, db, uid, gid, user, group, node: NODE, profile, pid: child.pid, pids: [child.pid], starts: 0, stops: 0, appLog, npmLog, realNpm: scenario === "legacy-upgrade" && process.env.FIBEROPS_TEST_FAST !== "1" ? realNpm : null }));
  fs.chmodSync(stateFile, 0o600);fs.chownSync(stateFile, uid, gid);
  return { dir, app, db, port, profile, stateFile, ownerPassword, secret, factory, counts, origin, before: snapshot(db), modeBefore: fs.statSync(db).mode & 0o777, dirModeBefore: fs.statSync(storage).mode & 0o777, ownerBefore: fs.statSync(db).uid, groupBefore: fs.statSync(db).gid };
}
function state(f) { return JSON.parse(fs.readFileSync(f.stateFile, "utf8")); }
function backups(f) {
  const dir = path.join(f.dir, "backups");return fs.existsSync(dir) ? fs.readdirSync(dir).map(name => path.join(dir, name)) : [];
}
const guide = fs.readFileSync(path.join(ROOT, "PERINTAH-UPDATE-PROXMOX.md"), "utf8").match(/<!-- existing-update-launcher:start -->\s*```bash\n([\s\S]*?)\n```/);
assert.ok(guide, "Panduan harus memuat satu launcher bertanda yang ikut diuji");
const guideEntry = path.join(TMP, "guide-launcher.sh");fs.writeFileSync(guideEntry, guide[1]);
function execute(f, { approve = true, pty = true, entry = path.join(ROOT, "scripts/update-existing.sh"), expectedTarget } = {}) {
  const env = { ...process.env, PATH: `${BIN}:${process.env.PATH}`, MOCK_EXISTING_STATE: f.stateFile, FIBEROPS_APP_DIR: f.app, FIBEROPS_SERVICE: "fiberops-isolated-fixture.service", FIBEROPS_BACKUP_DIR: path.join(f.dir, "backups") };
  if (expectedTarget) env.FIBEROPS_EXPECTED_TARGET = expectedTarget;
  if (state(f).scenario === "backup-dir-unsafe") {
    env.FIBEROPS_BACKUP_DIR = path.join(f.dir, "non-private-backup");fs.mkdirSync(env.FIBEROPS_BACKUP_DIR, { mode: 0o755 });
  }
  const args = ["bash", entry];
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const result = pty
    ? spawnSync("script", ["-q", "-e", "-c", args.map(quote).join(" "), "/dev/null"], { env, encoding: "utf8", input: approve ? "LANJUT\n" : "TUNDA\n", timeout: 120000, maxBuffer: 6 * 1024 * 1024 })
    : spawnSync(args[0], args.slice(1), { env, encoding: "utf8", timeout: 120000, maxBuffer: 6 * 1024 * 1024 });
  const log = (result.stdout || "") + (result.stderr || "");
  fs.writeFileSync(path.join(f.dir, `update-${backups(f).length}.log`), log);
  assert.ok(!log.includes(f.ownerPassword) && !log.includes(f.secret), "Password/environment secret tercetak");
  return { ...result, log };
}
async function request(f, method, route, body, token) {
  const response = await fetch(`http://127.0.0.1:${f.port}${route}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();let data;try { data = JSON.parse(text); } catch {}
  return { status: response.status, data, text };
}
async function login(f, email, password) {
  const result = await request(f, "POST", "/api/login", { email, password });
  assert.equal(result.status, 200, `Kredensial akun lama ditolak: ${email}`);return result.data;
}
function verifyBackup(f) {
  const dirs = backups(f);assert.ok(dirs.length);
  const backup = dirs.at(-1), file = path.join(backup, "database.db");
  compare(f.before, file);
  assert.equal(fs.statSync(backup).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(file).uid, 0);
  assert.equal(fs.readFileSync(path.join(backup, "database-path.txt"), "utf8").trim(), fs.realpathSync(f.db));
  assert.equal(fs.readFileSync(path.join(backup, "commit-before.txt"), "utf8").trim(), f.origin.before);
  assert.equal(fs.readFileSync(path.join(backup, "commit-target.txt"), "utf8").trim(), f.origin.target);
  assert.ok(fs.statSync(path.join(backup, "code-before.tar.gz")).size > 0);
  assert.ok(fs.statSync(path.join(backup, "dist-before.tar.gz")).size > 0);
  return backup;
}
async function cleanup(f) {
  if (!f) return;
  for (const pid of new Set(state(f).pids)) await terminate(pid);
}
async function check(name, fn) { await fn();passed++;console.log(`OK ${name}`); }
try {
  const legacy = repository("legacy-origin", OLD), modern = repository("modern-origin", MERGED), badBackup = repository("bad-backup-origin", OLD, true);
  const cases = [
    "legacy-upgrade", "modern-c320", "production-private", "guide-bootstrap", "security-session-migration", "dirty", "fetch-fail", "unpublished-helper", "target-drift", "pid-drift", "dynamic", "bad-hash", "bad-capacity", "missing-odp-splitter", "warning-decline", "warning-no-tty", "backup-dir-unsafe", "stop-fail", "backup-fail", "build-fail", "probe-drift", "probe-fail", "start-fail", "live-drift", "env-drift", "other-reader", "production-factory",
  ].filter(name => !process.env.FIBEROPS_TEST_ONLY || process.env.FIBEROPS_TEST_ONLY.split(",").includes(name));
  assert.ok(cases.length, "Tidak ada skenario dipilih; jangan melaporkan lulus kosong");
  for (const scenario of cases) {
    const origin = scenario === "modern-c320" ? modern : scenario === "backup-fail" ? badBackup : legacy;
    current = await fixture(scenario, origin, { modern: scenario === "modern-c320", model: scenario === "modern-c320" ? "ZTE C320" : "ZTE C300", production: scenario.startsWith("production-"), factory: scenario !== "production-private" });
    if (scenario === "legacy-upgrade") {
      await check("snapshot aktif memasukkan transaksi WAL yang sudah commit", () => {
        assert.ok(fs.statSync(current.db + "-wal").size > 32);
        const destination = path.join(current.dir, "wal-copy");fs.mkdirSync(destination, { mode: 0o700 });fs.chownSync(destination, uid, gid);
        asUser(NODE, [path.join(ROOT, "scripts/backup.mjs"), current.db, path.join(destination, "snapshot.db")], { env: current.profile });
        compare(current.before, path.join(destination, "snapshot.db"));
      });
    }
    if (scenario === "unpublished-helper") git(["--git-dir", origin.remote, "update-ref", "refs/heads/main", origin.before], origin.repo);
    if (scenario === "other-reader") {
      const alias = path.join(path.dirname(current.db), "hardlink alias.db");fs.linkSync(current.db, alias);
      extra = spawn(NODE, ["-e", "require('fs').openSync(process.argv[1],'r');console.log('READY');setInterval(()=>{},1000)", alias], { uid, gid, stdio: ["ignore", "pipe", "ignore"] });
      await once(extra.stdout, "data");
    }
    const result = execute(current, {
      approve: scenario !== "warning-decline", pty: scenario !== "warning-no-tty",
      ...(scenario === "guide-bootstrap" ? { entry: guideEntry } : {}),
      ...(scenario === "target-drift" ? { expectedTarget: origin.before } : {}),
    });
    if (scenario === "legacy-upgrade" && process.env.FIBEROPS_TEST_FAST !== "1") realNpmRan = true;
    if (scenario === "unpublished-helper") git(["--git-dir", origin.remote, "update-ref", "refs/heads/main", origin.target], origin.repo);
    const after = state(current), success = ["legacy-upgrade", "modern-c320", "production-private", "guide-bootstrap", "security-session-migration"].includes(scenario);
    await check(`${scenario}: gate, backup, identitas/isi lama, dan status service`, async () => {
      if (success) {
        assert.equal(result.status, 0, result.log);
        assert.equal(after.starts, 1);assert.equal(after.stops, 1);assert.ok(alive(after.pid));
        assert.match(result.log, /SALINAN LULUS/);assert.match(result.log, /DATA LULUS/);assert.match(result.log, /UPDATE EXISTING SELESAI/);
        assert.equal(git(["rev-parse", "HEAD"], current.app), origin.target);
        compare(current.before, current.db);verifyBackup(current);
        assert.equal(fs.statSync(current.db).mode & 0o777, current.modeBefore);assert.equal(fs.statSync(path.dirname(current.db)).mode & 0o777, current.dirModeBefore);assert.equal(fs.statSync(current.db).uid, current.ownerBefore);assert.equal(fs.statSync(current.db).gid, current.groupBefore);
      } else {
        assert.notEqual(result.status, 0, `Unexpected success: ${scenario}\n${result.log}`);
        const beforeStop = ["dirty", "fetch-fail", "unpublished-helper", "target-drift", "pid-drift", "dynamic", "bad-hash", "bad-capacity", "missing-odp-splitter", "warning-decline", "warning-no-tty", "backup-dir-unsafe", "production-factory"].includes(scenario);
        if (beforeStop) { assert.equal(after.stops, 0, result.log);assert.equal(after.starts, 0);assert.ok(alive(after.pid));assert.equal(git(["rev-parse", "HEAD"], current.app), origin.before); }
        else if (scenario === "stop-fail") {
          assert.ok(after.stops >= 1);assert.equal(after.starts, 0);assert.ok(alive(after.pid));
          assert.equal(git(["rev-parse", "HEAD"], current.app), origin.before);assert.match(result.log, /tidak dapat memastikan service berhenti/);
          assert.ok(!fs.existsSync(path.join(backups(current)[0], "database.db")), "Tidak boleh backup/pull bila stop gagal");
        } else { assert.ok(after.stops >= 1, result.log);assert.equal(after.pid, 0);if (["backup-fail", "other-reader"].includes(scenario)) assert.equal(git(["rev-parse", "HEAD"], current.app), origin.before);else assert.equal(git(["rev-parse", "HEAD"], current.app), origin.target); }
        if (scenario !== "live-drift") compare(current.before, current.db);
        if (scenario === "backup-dir-unsafe") assert.equal(fs.statSync(path.join(current.dir, "non-private-backup")).mode & 0o777, 0o755, "Jangan chmod direktori backup existing secara diam-diam");
        if (!["backup-fail", "stop-fail", "other-reader"].includes(scenario) && !beforeStop) verifyBackup(current);
        if (["probe-drift", "probe-fail"].includes(scenario)) { assert.equal(after.starts, 0);assert.ok(!sql(current.db, db => db.prepare("SELECT 1 FROM pragma_table_info('olts') WHERE name='coordinate_mode'").get()), "DB asli terkena migrasi probe"); }
      }
    });
    if (success) {
      await check(`${scenario}: login akun lama dan pembatasan role tetap berlaku`, async () => {
        const owner = await login(current, accounts.owner, current.ownerPassword);
        const operator = await login(current, accounts.operator, current.factory ? factoryPassword : "OperatorFixturePrivate123!");
        const reader = await login(current, accounts.reader, current.factory ? factoryPassword : "ReaderFixturePrivate123!");
        assert.equal(owner.user.role, "admin");assert.equal(operator.user.id, 501);assert.equal(operator.user.role, "operator");assert.equal(reader.user.id, 509);assert.equal(reader.user.role, "user");
        assert.equal((await request(current, "GET", "/api/map-data", undefined, reader.token)).status, 200);
        assert.equal((await request(current, "POST", "/api/olts", { name: "Dilarang" }, reader.token)).status, 403);
        assert.equal((await request(current, "GET", "/api/users", undefined, operator.token)).status, 403);
        const dashboard = await request(current, "GET", "/api/dashboard", undefined, owner.token);
        assert.equal(dashboard.data.olts, current.counts.olts);assert.equal(dashboard.data.cards, current.counts.cards);assert.equal(dashboard.data.ports, current.counts.ports);assert.equal(dashboard.data.odcs, current.counts.odcs);assert.equal(dashboard.data.odps, current.counts.odps);
        assert.ok(sql(current.db, db => db.prepare("SELECT password_hash FROM users WHERE email=?").get(accounts.owner).password_hash).startsWith("scrypt$"), "Login valid memigrasikan hash lama, bukan password");
        const map = await request(current, "GET", "/api/map-data", undefined, owner.token);
        assert.ok(!map.text.includes("password_hash"));assert.equal(map.data.odcs.filter(row => row.name === "ODC-NAMA-SAMA-UJI").length, 2);
        assert.equal(sql(current.db, db => db.prepare("SELECT target_odc_splitter_id FROM splitter_outputs WHERE splitter_id=9001 AND port=3").get().target_odc_splitter_id), null, "Receiver kosong tidak boleh ditebak");
        if (scenario === "modern-c320") {
          const layer = await request(current, "GET", "/api/route-imports/71", undefined, reader.token);
          assert.equal(layer.status, 200);assert.equal(layer.data.routes[0].id, 97);assert.deepEqual(layer.data.routes[0].coordinates, [[100.64, -0.79], [100.65, -0.81], [100.66, -0.82]]);
        }
      });
    }
    if (scenario === "legacy-upgrade") {
      await check("input baru bertahan saat updater memperbarui file dirinya sendiri", async () => {
        const owner = await login(current, accounts.owner, current.ownerPassword);
        const added = await request(current, "POST", "/api/odcs", { name: "ODC-UJI-INPUT-SETELAH-UPDATE", olt_id: 41, cable_type: "48_core_4_tube", location: "Alamat baru sintetis", notes: "Input setelah deploy pertama" }, owner.token);
        assert.equal(added.status, 201);assert.ok(added.data.id > 99991, "Penghitung ID tidak boleh di-reset ke MAX baris yang tersisa");
        const odp = await request(current, "POST", "/api/odps", { name: "ODP-UJI-INPUT-BARU", odc_id: added.data.id, cable_type: "12_core_2_tube" }, owner.token);assert.equal(odp.status, 201);
        const beforeRepeat = snapshot(current.db);
        const entry = path.join(origin.repo, "scripts/update-existing.sh"), source = fs.readFileSync(entry, "utf8");
        fs.writeFileSync(entry, source.replace("#!/usr/bin/env bash\n", "#!/usr/bin/env bash\n" + "# FUTURE RELEASE FIXTURE: frozen shell must not reread this changed file.\n".repeat(40)));
        git(["add", "scripts/update-existing.sh"], origin.repo);git(["commit", "-qm", "Fixture updater self replacement"], origin.repo);
        const next = git(["rev-parse", "HEAD"], origin.repo);
        git(["--git-dir", origin.remote, "fetch", "origin", "main"], origin.repo);
        git(["--git-dir", origin.remote, "update-ref", "refs/heads/main", next], origin.repo);
        try {
          const repeat = execute(current, { entry: path.join(current.app, "scripts/update-existing.sh"), expectedTarget: next });
          assert.equal(repeat.status, 0, repeat.log);compare(beforeRepeat, current.db);
          assert.equal(git(["rev-parse", "HEAD"], current.app), next);
          assert.equal(sql(current.db, db => db.prepare("SELECT notes FROM odcs WHERE id=?").get(added.data.id).notes), "Input setelah deploy pertama");
        } finally { git(["--git-dir", origin.remote, "update-ref", "refs/heads/main", origin.target], origin.repo); }
      });
      await check("rollback kode+DB pasangan sebelum upgrade diuji hanya pada salinan", async () => {
        const backup = backups(current)[0], restore = path.join(current.dir, "restore-only"), file = path.join(restore, "restored.db");
        fs.mkdirSync(restore, { mode: 0o755 });
        run("tar", ["-xzf", path.join(backup, "code-before.tar.gz"), "-C", restore]);
        fs.copyFileSync(path.join(backup, "database.db"), file);own(restore);
        compare(current.before, file);
        const port = await freePort(), child = spawn(NODE, [path.join(restore, "server.mjs")], { cwd: restore, env: { ...current.profile, ARENA_DB_PATH: file, ARENA_API_PORT: String(port), ARENA_PUBLIC_ORIGIN: `http://127.0.0.1:${port}` }, uid, gid, stdio: "ignore" });background.add(child);
        await ready(port, child.pid);
        const result = await fetch(`http://127.0.0.1:${port}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: accounts.owner, password: current.ownerPassword }) });assert.equal(result.status, 200);
        await terminate(child.pid);
      });
    }
    if (extra) { await terminate(extra.pid);extra = null; }
    await cleanup(current);current = null;
  }
  assert.equal(run("git", ["-C", ROOT, "branch", "--show-current"], { env: gitEnv }), branchBefore);
  console.log(`\nUPGRADE EXISTING: ${passed} pemeriksaan / ${cases.length} skenario lulus. Git/SQLite/API/UID nyata pada fixture lokal; systemctl dimock. npm nyata: ${realNpmRan ? "legacy-upgrade" : "TIDAK (skenario tidak dipilih/mode cepat)"}.`);
  console.log(`Baseline lama: ${OLD}; baseline merged: ${MERGED}; kandidat: kode aplikasi workspace saat tes. Tidak mengakses Proxmox/data pengguna.`);
} catch (error) {
  console.error(error);process.exitCode = 1;
  if (current) console.error(`Log fixture privat: ${current.dir}`);
} finally {
  if (extra) await terminate(extra.pid).catch(() => {});
  await cleanup(current).catch(() => {});
  for (const child of background) if (alive(child.pid)) await terminate(child.pid).catch(() => {});
  if (!process.exitCode && process.env.FIBEROPS_KEEP_UPGRADE_FIXTURES !== "1") fs.rmSync(TMP, { recursive: true, force: true });
  else console.error(`Fixture disimpan: ${TMP}`);
}
