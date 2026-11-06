#!/usr/bin/env bash
# Update kode existing tanpa mengganti akun/password, unit, mode, atau path DB.
# Strict updater produksi tetap scripts/update-native.sh; tidak ada bypass login.
# Bekukan sumber shell sebelum git merge dapat mengganti file updater itu sendiri.
if [[ ${FIBEROPS_EXISTING_FROZEN:-} != 1 ]]; then
  SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P) || exit 1
  exec env FIBEROPS_EXISTING_FROZEN=1 FIBEROPS_EXISTING_SOURCE="$SOURCE" bash -c "$(cat -- "${BASH_SOURCE[0]}")" -- "$@"
fi
set -Eeuo pipefail
umask 077
APP=${FIBEROPS_APP_DIR:-/opt/fiberops}
SERVICE=${FIBEROPS_SERVICE:-fiberops.service}
BACKUP_BASE=${FIBEROPS_BACKUP_DIR:-/var/backups/fiberops/existing}
STOPPED=0
BACKUP=''
TMP=''
SNAP=''
fail() { printf '\nTUNDA: %s\n' "$*" >&2; exit 1; }
finish() {
  local rc=$?
  if (( rc != 0 )); then
    printf '\nUPDATE EXISTING TIDAK SELESAI (kode %s).\n' "$rc" >&2
    if (( STOPPED )); then
      if systemctl stop "$SERVICE" && [[ "$(systemctl show "$SERVICE" -p MainPID --value)" == 0 ]]; then
        printf 'Service dihentikan. Tidak ada rollback otomatis atau reset data.\n' >&2
      else
        printf 'PENTING: tidak dapat memastikan service berhenti; periksa semua proses sebelum menyentuh DB. Tidak ada rollback/reset otomatis.\n' >&2
      fi
    else
      printf 'Service belum diminta berhenti; kode/akun/database belum diperbarui.\n' >&2
    fi
    [[ -z "$BACKUP" ]] || printf 'Backup privat: %s\n' "$BACKUP" >&2
  fi
  [[ -z "$TMP" ]] || rm -rf -- "$TMP"
  [[ -z "$SNAP" ]] || rm -rf -- "$SNAP"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
(( EUID == 0 )) || fail 'Jalankan sebagai root di VM/LXC aplikasi, bukan host Proxmox lain.'
(( $# == 0 )) || fail 'Updater tidak menerima argumen; baca panduan sebelum menjalankan.'
for cmd in git node npm systemctl getent stat readlink mktemp install tar gzip curl flock tee cut chmod chown grep rm cp ln cmp; do
  command -v "$cmd" >/dev/null || fail "Perintah $cmd belum tersedia."
done
RUNUSER=$(command -v runuser || true)
[[ -n "$RUNUSER" ]] || RUNUSER=/usr/sbin/runuser
[[ -x "$RUNUSER" ]] || fail 'runuser tidak tersedia.'
exec 9>/run/lock/fiberops-update.lock
flock -n 9 || fail 'Ada updater FiberOps lain berjalan.'
[[ -d "$APP/.git" ]] || fail 'Checkout Git tidak ditemukan; jangan instal ulang atau menebak direktori.'
cd "$APP"
APP=$(pwd -P)
systemctl is-active --quiet "$SERVICE" || fail 'Service harus aktif agar konteks runtime dapat diverifikasi.'
[[ "$(systemctl show "$SERVICE" -p DynamicUser --value)" != yes ]] || fail 'DynamicUser tidak didukung prosedur ini.'
PID=$(systemctl show "$SERVICE" -p MainPID --value)
[[ "$PID" =~ ^[1-9][0-9]*$ ]] || fail 'MainPID tidak valid.'
TMP=$(mktemp -d /tmp/fiberops-existing.XXXXXXXX)
chmod 755 "$TMP"
install -m 644 "$FIBEROPS_EXISTING_SOURCE/check-existing-update.mjs" "$TMP/check.mjs"

# Environment hanya disalin ke file root-0600 sementara; tidak dicetak/di-argv.
cat >"$TMP/context.mjs" <<'NODE_CONTEXT'
import fs from 'node:fs';
import path from 'node:path';
const [pid,app,envFile]=process.argv.slice(2),base=`/proc/${pid}`;
const env=Object.fromEntries(fs.readFileSync(`${base}/environ`,'utf8').split('\0').filter(Boolean).map(value=>{const i=value.indexOf('=');return[value.slice(0,i),value.slice(i+1)];}));
const args=fs.readFileSync(`${base}/cmdline`,'utf8').split('\0').filter(Boolean),cwd=fs.realpathSync(`${base}/cwd`),node=fs.readlinkSync(`${base}/exe`);
if(!/^node(?:js)?$/.test(path.basename(node))||cwd!==app||path.resolve(cwd,args[1]||'')!==path.join(app,'server.mjs'))throw Error('Perlu Node server.mjs langsung dengan WorkingDirectory aplikasi; npm/PM2/Docker/wrapper tidak ditebak.');
if(args.some(a=>/^--(?:env-file|env-file-if-exists|require|import|loader|experimental-loader|eval)(?:=|$)|^-(?:r|e)$/.test(a))||/(?:--env-file|--require|--import|--loader|--experimental-loader|(?:^|\s)-r(?:\s|$))/.test(env.NODE_OPTIONS||''))throw Error('Pemuat environment/module tambahan perlu diperiksa manual.');
if(!['','development','production','test'].includes(env.NODE_ENV||''))throw Error('NODE_ENV tidak dikenal; tidak diubah otomatis.');
if(!fs.existsSync(node))throw Error('Executable Node service tidak tersedia.');
const db=fs.realpathSync(path.resolve(cwd,env.ARENA_DB_PATH||path.join(app,'data/fiberops.db'))),st=fs.statSync(db);
if(!st.isFile()||!st.size)throw Error('DB bukan file existing berisi data.');
if(!fs.readdirSync(`${base}/fd`).some(fd=>{try{const f=fs.statSync(`${base}/fd/${fd}`);return f.dev===st.dev&&f.ino===st.ino;}catch{return false;}}))throw Error('DB konfigurasi tidak cocok dengan file terbuka PID service.');
const status=fs.readFileSync(`${base}/status`,'utf8'),uid=status.match(/^Uid:\s+\d+\s+(\d+)/m)?.[1],gid=status.match(/^Gid:\s+\d+\s+(\d+)/m)?.[1];
if(!uid||!gid)throw Error('UID/GID service tidak ditemukan.');
let host=env.ARENA_API_HOST||'0.0.0.0';if(host==='0.0.0.0')host='127.0.0.1';if(host==='::')host='::1';if(host.includes(':')&&!host.startsWith('['))host=`[${host}]`;
const port=Number(env.ARENA_API_PORT||4500);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Port service tidak valid.');
fs.writeFileSync(envFile,JSON.stringify(env),{mode:0o600,flag:'wx'});
for(const value of [node,db,uid,gid,`http://${host}:${port}/healthz`,env.NODE_ENV||''])process.stdout.write(value+'\0');
NODE_CONTEXT
node "$TMP/context.mjs" "$PID" "$APP" "$TMP/environment.json" >"$TMP/context"
mapfile -d '' -t CTX <"$TMP/context"
(( ${#CTX[@]} == 6 )) || fail 'Konteks tidak lengkap.'
NODE=${CTX[0]}; DB=${CTX[1]}; UID_SERVICE=${CTX[2]}; GID_SERVICE=${CTX[3]}; HEALTH=${CTX[4]}; MODE=${CTX[5]}
SERVICE_USER=$(getent passwd "$UID_SERVICE" | cut -d: -f1)
SERVICE_GROUP=$(getent group "$GID_SERVICE" | cut -d: -f1)
CODE_USER=$(getent passwd "$(stat -c %u "$APP/.git")" | cut -d: -f1)
[[ -n "$SERVICE_USER" && -n "$SERVICE_GROUP" && -n "$CODE_USER" ]] || fail 'Akun OS tidak ditemukan.'
export PATH="$(dirname "$NODE"):$PATH"
run_code() { "$RUNUSER" -u "$CODE_USER" -- env PATH="$PATH" "$@"; }
run_service() { "$RUNUSER" -u "$SERVICE_USER" -g "$SERVICE_GROUP" -- env PATH="$PATH" "$@"; }
"$NODE" -e 'const[a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<13))process.exit(1)' || fail 'Runtime service perlu Node 22.13+.'
[[ "$(run_code git rev-parse --show-toplevel)" == "$APP" ]] || fail 'Root Git tidak cocok.'
[[ "$(run_code git branch --show-current)" == main ]] || fail 'Checkout server harus main; tidak berpindah branch otomatis.'
[[ -z "$(run_code git status --porcelain)" ]] || fail 'Perubahan lokal ditemukan; tidak melakukan stash/reset paksa.'

printf '\n[1/7] Memeriksa target main dan data existing (belum stop/pull)...\n'
run_code git fetch origin
OLD=$(run_code git rev-parse HEAD)
TARGET=$(run_code git rev-parse origin/main)
[[ -z ${FIBEROPS_EXPECTED_TARGET:-} || "$TARGET" == "$FIBEROPS_EXPECTED_TARGET" ]] || fail 'origin/main berubah setelah launcher disiapkan; tinjau commit dan ulangi.'
run_code git merge-base --is-ancestor "$OLD" "$TARGET" || fail 'main tidak fast-forward; periksa manual.'
run_code git cat-file -e "$TARGET:scripts/update-existing.sh" || fail 'main belum memuat updater existing. Merge PR pendukung terlebih dahulu.'
mkdir "$TMP/target"
run_code git archive "$TARGET" scripts/preflight.mjs scripts/backup.mjs server/security.mjs src/lib | tar -xf - -C "$TMP/target"
chmod -R a+rX "$TMP/target"
ln -s "$APP/dist" "$TMP/target/dist"
run_service env NODE_ENV="$MODE" "$NODE" "$TMP/target/scripts/preflight.mjs" "$DB" --preserve-accounts | tee "$TMP/preflight.log"
if grep -q '^CEK   ' "$TMP/preflight.log"; then
  printf '\nBaca peringatan. Akun/password dan mode service TIDAK diubah. Jika perlu koreksi fisik/data, tunda.\n'
  read -r -p 'Ketik LANJUT untuk maintenance dan pengujian salinan: ' ANSWER </dev/tty
  [[ "$ANSWER" == LANJUT ]] || fail 'Ditunda operator.'
fi
BACKUP_BASE=$(readlink -m "$BACKUP_BASE")
case "$BACKUP_BASE/" in "$APP/"*) fail 'Backup harus di luar checkout aplikasi.';; esac
case "$APP/" in "$BACKUP_BASE/"*) fail 'Direktori backup tidak boleh menjadi induk aplikasi.';; esac
case "$DB" in "$BACKUP_BASE/"*) fail 'Direktori backup tidak boleh menjadi induk DB asli.';; esac
[[ "$BACKUP_BASE" != / ]] || fail 'Root filesystem bukan direktori backup.'
if [[ -e "$BACKUP_BASE" ]]; then
  [[ -d "$BACKUP_BASE" && "$(stat -c '%u:%g:%a' "$BACKUP_BASE")" == 0:0:700 ]] || fail 'Direktori backup existing harus root:root-0700; pilih subdirektori privat baru, jangan mengubah izin direktori data/sistem.'
else
  install -d -o root -g root -m 700 "$BACKUP_BASE"
fi
BACKUP=$(mktemp -d "$BACKUP_BASE/existing-$(date +%Y%m%d-%H%M%S).XXXXXXXX")
printf '%s\n' "$OLD" >"$BACKUP/commit-before.txt"
printf '%s\n' "$TARGET" >"$BACKUP/commit-target.txt"
printf '%s\n' "$DB" >"$BACKUP/database-path.txt"
systemctl cat "$SERVICE" >"$BACKUP/service-before.txt"
cp "$TMP/preflight.log" "$BACKUP/preflight-before.log"
run_code git archive --format=tar "$OLD" | gzip >"$BACKUP/code-before.tar.gz"
if [[ -d dist ]]; then tar -czpf "$BACKUP/dist-before.tar.gz" dist; fi
printf 'Backup privat: %s\nDB existing: %s\n' "$BACKUP" "$DB"

printf '\n[2/7] Maintenance dan snapshot SQLite konsisten...\n'
[[ "$(systemctl show "$SERVICE" -p MainPID --value)" == "$PID" ]] || fail 'PID berubah saat persiapan; periksa runtime lalu ulangi, jangan menebak DB.'
"$NODE" "$TMP/context.mjs" "$PID" "$APP" "$TMP/environment-confirm.json" >"$TMP/context-confirm"
cmp -s "$TMP/context" "$TMP/context-confirm" || fail 'Konteks/DB berubah sebelum maintenance.'
STOPPED=1
systemctl stop "$SERVICE"
[[ "$(systemctl show "$SERVICE" -p MainPID --value)" == 0 ]] || fail 'Service belum berhenti.'
"$NODE" "$TMP/check.mjs" writers "$DB"
SNAP=$(mktemp -d /tmp/fiberops-existing-snapshot.XXXXXXXX)
chown "$UID_SERVICE:$GID_SERVICE" "$SNAP"
run_service "$NODE" "$TMP/target/scripts/backup.mjs" "$DB" "$SNAP/database.db"
install -o root -g root -m 600 "$SNAP/database.db" "$BACKUP/database.db"
"$NODE" "$TMP/check.mjs" snapshot "$BACKUP/database.db" "$BACKUP/data-before.json"

printf '\n[3/7] Fast-forward kode dan build dari lockfile...\n'
[[ "$(run_code git rev-parse HEAD)" == "$OLD" && -z "$(run_code git status --porcelain)" ]] || fail 'Checkout berubah saat maintenance.'
run_code git merge --ff-only "$TARGET"
run_code npm ci --include=dev
run_code npm run build

printf '\n[4/7] Uji startup/migrasi pada SALINAN lokal, bukan DB asli...\n'
FIBEROPS_RUNUSER="$RUNUSER" "$NODE" "$TMP/check.mjs" probe "$APP" "$BACKUP/database.db" "$BACKUP/data-before.json" "$TMP/environment.json" "$NODE" "$SERVICE_USER" "$SERVICE_GROUP" "$UID_SERVICE" "$GID_SERVICE" "$BACKUP/probe.log"
"$NODE" "$TMP/check.mjs" compare "$BACKUP/data-before.json" "$DB"

printf '\n[5/7] Startup pada DB existing dengan unit/environment tetap...\n'
systemctl start "$SERVICE"
curl --fail --silent --show-error --retry 15 --retry-delay 1 --retry-connrefused --retry-max-time 45 --max-time 3 "$HEALTH" >"$BACKUP/health.json"
systemctl is-active --quiet "$SERVICE" || fail 'Service tidak aktif.'
"$NODE" -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(d.ok!==true||d.service!=="fiberops-arena-api")process.exit(1)' "$BACKUP/health.json"
NEW_PID=$(systemctl show "$SERVICE" -p MainPID --value)
"$NODE" "$TMP/context.mjs" "$NEW_PID" "$APP" "$TMP/environment-after.json" >"$TMP/context-after"
cmp -s "$TMP/context" "$TMP/context-after" || fail 'Runtime/path DB/user/mode/health service berubah; periksa konfigurasi.'
"$NODE" --input-type=module - "$TMP/environment.json" "$TMP/environment-after.json" <<'NODE_POLICY'
import fs from 'node:fs';
const [before,after]=process.argv.slice(2).map(file=>JSON.parse(fs.readFileSync(file,'utf8')));
for(const key of new Set([...Object.keys(before),...Object.keys(after)])) {
  if((key.startsWith('ARENA_')||key==='NODE_ENV'||key==='NODE_OPTIONS')&&before[key]!==after[key])throw Error('Konfigurasi aplikasi berubah selama update; nilainya tidak dicetak.');
}
NODE_POLICY

printf '\n[6/7] Memverifikasi seluruh nilai lama dan integritas DB...\n'
"$NODE" "$TMP/check.mjs" compare "$BACKUP/data-before.json" "$DB"
run_service env NODE_ENV="$MODE" "$NODE" scripts/preflight.mjs "$DB" --preserve-accounts | tee "$BACKUP/preflight-after.log"

printf '\n[7/7] UPDATE EXISTING SELESAI. Akun/password, nilai/ID lama, dan konfigurasi tetap.\n'
printf 'Kode: %s\nBackup: %s\n' "$TARGET" "$BACKUP"
printf 'Sesi lama mungkin dicabut migrasi keamanan; login ulang bukan reset akun. Verifikasi aplikasi sebelum operator kembali input.\n'
STOPPED=0
