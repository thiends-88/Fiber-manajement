#!/usr/bin/env bash
# Jalankan di VM/LXC aplikasi, sebagai root; bukan di host Proxmox yang lain.
# Tidak mereset DB/user, mengubah unit/environment, atau melakukan rollback otomatis.
set -Eeuo pipefail
umask 077

APP=${FIBEROPS_APP_DIR:-/opt/fiberops}
SERVICE=${FIBEROPS_SERVICE:-fiberops.service}
BACKUP_BASE=${FIBEROPS_BACKUP_DIR:-/var/backups/fiberops}
STOPPED=0
BACKUP=''
TMP=''
SNAP=''
fail() { printf '\nTUNDA: %s\n' "$*" >&2; exit 1; }
finish() {
  local rc=$?
  if (( rc != 0 )); then
    printf '\nUPDATE TIDAK SELESAI (kode %s).\n' "$rc" >&2
    if (( STOPPED )); then
      systemctl stop "$SERVICE" || true
      printf 'Layanan dibiarkan berhenti agar kode/data yang belum lolos pemeriksaan tidak dipakai.\n' >&2
    else
      printf 'Skrip belum meminta penghentian layanan.\n' >&2
    fi
    [[ -z "$BACKUP" ]] || printf 'Direktori pemulihan privat: %s\n' "$BACKUP" >&2
    printf 'Jangan hapus/reset DB atau menjalankan git reset --hard. Baca error di atas.\n' >&2
  fi
  [[ -z "$TMP" ]] || rm -rf -- "$TMP"
  [[ -z "$SNAP" ]] || rm -rf -- "$SNAP"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

(( EUID == 0 )) || fail 'Masuk sebagai root terlebih dahulu (sudo -i bila tersedia).'
for cmd in git node npm systemctl getent stat readlink mktemp install tar gzip curl flock tee cut chmod chown grep rm; do
  command -v "$cmd" >/dev/null || fail "Perintah $cmd belum tersedia; belum ada update aplikasi."
done
RUNUSER=$(command -v runuser || true)
[[ -n "$RUNUSER" ]] || RUNUSER=/usr/sbin/runuser
[[ -x "$RUNUSER" ]] || fail 'runuser tidak tersedia (paket util-linux); jangan lanjut dulu.'
exec 9>/run/lock/fiberops-update.lock
flock -n 9 || fail 'Ada proses update FiberOps lain.'
[[ -d "$APP/.git" ]] || fail "Checkout Git tidak ditemukan di $APP. Pastikan ini terminal VM/LXC aplikasi."
cd "$APP"
APP=$(pwd -P)
systemctl is-active --quiet "$SERVICE" || fail 'Service harus aktif agar konfigurasi DB/runtime yang benar dapat diperiksa. Jangan menebak path DB.'
[[ "$(systemctl show "$SERVICE" -p DynamicUser --value)" != yes ]] || fail 'Service DynamicUser perlu prosedur khusus; akun OS tidak boleh ditebak setelah stop.'
PID=$(systemctl show "$SERVICE" -p MainPID --value)
[[ "$PID" =~ ^[1-9][0-9]*$ ]] || fail 'PID service tidak ditemukan.'
TMP=$(mktemp -d /tmp/fiberops-update.XXXXXXXX)
chmod 755 "$TMP"

# Baca hanya field yang diperlukan. Isi environment/kredensial tidak dicetak.
node --input-type=module - "$PID" "$APP" >"$TMP/context" <<'NODE_CONTEXT'
import fs from 'node:fs';
import path from 'node:path';
const [pid,app]=process.argv.slice(2),base=`/proc/${pid}`;
const env=Object.fromEntries(fs.readFileSync(`${base}/environ`,'utf8').split('\0').filter(Boolean).map(s=>{const n=s.indexOf('=');return[s.slice(0,n),s.slice(n+1)];}));
const args=fs.readFileSync(`${base}/cmdline`,'utf8').split('\0').filter(Boolean),cwd=fs.realpathSync(`${base}/cwd`);
const node=fs.readlinkSync(`${base}/exe`),status=fs.readFileSync(`${base}/status`,'utf8');
if(!/^node(?:js)?$/.test(path.basename(node))||path.resolve(cwd,args[1]||'')!==path.join(app,'server.mjs'))throw Error('Service bukan Node server.mjs langsung; perlu panduan khusus (npm/PM2/Docker/wrapper tidak ditebak).');
if(args.some(a=>/^--(?:env-file|env-file-if-exists|require|import|loader|experimental-loader|eval)(?:=|$)|^-(?:r|e)$/.test(a))||/(?:--env-file|--require|--import|--loader|--experimental-loader|(?:^|\s)-r(?:\s|$))/.test(env.NODE_OPTIONS||''))throw Error('Ada pemuat environment/module tambahan; path DB efektif perlu diperiksa manual.');
if(env.NODE_ENV!=='production')throw Error('Service belum memakai NODE_ENV=production. Skrip tidak mengubah konfigurasi otomatis; periksa unit/environment dahulu.');
if(!fs.existsSync(node))throw Error('Executable Node service sudah dipindah/dihapus.');
const db=fs.realpathSync(path.resolve(cwd,env.ARENA_DB_PATH||path.join(app,'data/fiberops.db'))),st=fs.statSync(db);
if(!st.isFile())throw Error('DB bukan file biasa.');
const holdsDb=fs.readdirSync(`${base}/fd`).some(fd=>{try{const x=fs.statSync(`${base}/fd/${fd}`);return x.dev===st.dev&&x.ino===st.ino;}catch{return false;}});
if(!holdsDb)throw Error('DB pada konfigurasi tidak cocok dengan file yang dibuka PID service. Jangan lanjut.');
let host=env.ARENA_API_HOST||'0.0.0.0';if(host==='0.0.0.0')host='127.0.0.1';if(host==='::')host='::1';if(host.includes(':')&&!host.startsWith('['))host=`[${host}]`;
const port=Number(env.ARENA_API_PORT||4500);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Port service tidak valid.');
const uid=status.match(/^Uid:\s+\d+\s+(\d+)/m)?.[1],gid=status.match(/^Gid:\s+\d+\s+(\d+)/m)?.[1];if(!uid||!gid)throw Error('UID/GID service tidak terbaca.');
for(const value of [node,db,uid,gid,`http://${host}:${port}/healthz`])process.stdout.write(value+'\0');
NODE_CONTEXT
mapfile -d '' -t CTX <"$TMP/context"
(( ${#CTX[@]} == 5 )) || fail 'Konteks service tidak lengkap.'
NODE=${CTX[0]}; DB=${CTX[1]}; UID_SERVICE=${CTX[2]}; GID_SERVICE=${CTX[3]}; HEALTH=${CTX[4]}
SERVICE_USER=$(getent passwd "$UID_SERVICE" | cut -d: -f1)
SERVICE_GROUP=$(getent group "$GID_SERVICE" | cut -d: -f1)
CODE_USER=$(getent passwd "$(stat -c %u "$APP/.git")" | cut -d: -f1)
[[ -n "$SERVICE_USER" && -n "$SERVICE_GROUP" && -n "$CODE_USER" ]] || fail 'Akun OS service/pemilik Git tidak dapat ditemukan.'
export PATH="$(dirname "$NODE"):$PATH"
run_code() { "$RUNUSER" -u "$CODE_USER" -- env PATH="$PATH" "$@"; }
run_service() { "$RUNUSER" -u "$SERVICE_USER" -g "$SERVICE_GROUP" -- env PATH="$PATH" "$@"; }
"$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<13)){console.error("Perlu Node 22.13+ pada runtime service");process.exit(1)}'
run_code "$NODE" --version
run_service "$NODE" --version
[[ "$(run_code git rev-parse --show-toplevel)" == "$APP" ]] || fail 'Root Git tidak cocok.'
[[ "$(run_code git branch --show-current)" == main ]] || fail 'Checkout Proxmox belum berada di main; periksa branch manual dahulu.'
[[ -z "$(run_code git status --porcelain)" ]] || fail 'Ada perubahan lokal. Simpan/tinjau dulu; skrip tidak menimpa perubahan tersebut.'

printf '\n[1/6] Mengambil referensi main (belum mengubah kode/DB)...\n'
run_code git fetch origin
OLD=$(run_code git rev-parse HEAD)
TARGET=$(run_code git rev-parse origin/main)
run_code git merge-base --is-ancestor "$OLD" "$TARGET" || fail 'main lokal bukan ancestor origin/main. Tidak melakukan merge/reset paksa.'
for file in scripts/backup.mjs scripts/preflight.mjs server/security.mjs; do
  run_code git cat-file -e "$TARGET:$file" || fail 'main belum memuat perbaikan pra-deploy. Merge PR yang benar dahulu.'
done
# Helper backup mandiri diambil tanpa checkout/pull; backup tetap mendahului perubahan kode.
run_code git show "$TARGET:scripts/backup.mjs" >"$TMP/backup.mjs"
run_code git show "$TARGET:server/security.mjs" >"$TMP/security.mjs"
chmod 644 "$TMP/backup.mjs" "$TMP/security.mjs"
# Tolak akun/hash bermasalah sebelum mematikan layanan. Tidak mengganti password.
run_service "$NODE" --input-type=module - "$DB" "$TMP/security.mjs" <<'NODE_ACCOUNTS'
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
const {FACTORY_PASSWORD,verifyPassword,validStoredPasswordHash}=await import(pathToFileURL(process.argv[3]));
const db=new DatabaseSync(process.argv[2],{readOnly:true});
try{const users=db.prepare('SELECT role,password_hash FROM users').all();
if(users.some(u=>!validStoredPasswordHash(u.password_hash)))throw Error('Ada hash akun tidak valid; periksa/rotasi secara lokal dahulu.');
const factory=users.filter(u=>verifyPassword(FACTORY_PASSWORD,u.password_hash)).length;
if(factory)throw Error(`${factory} akun masih berpassword pabrik (termasuk akun demo sisa). Rotasi secara lokal dahulu; akun pribadi tidak direset.`);
if(!users.some(u=>u.role==='admin'&&!verifyPassword(FACTORY_PASSWORD,u.password_hash)))throw Error('Belum ada admin pribadi yang valid.');
console.log('Akun/hash lolos pemeriksaan awal; password dan identitas tidak diubah.');}finally{db.close();}
NODE_ACCOUNTS
install -d -o root -g root -m 700 "$BACKUP_BASE"
BACKUP=$(mktemp -d "$BACKUP_BASE/update-$(date +%Y%m%d-%H%M%S).XXXXXXXX")
printf '%s\n' "$OLD" >"$BACKUP/commit-before.txt"
printf '%s\n' "$TARGET" >"$BACKUP/commit-target.txt"
printf '%s\n' "$DB" >"$BACKUP/database-path.txt"
systemctl cat "$SERVICE" >"$BACKUP/service-before.txt"
run_code git archive --format=tar "$OLD" | gzip >"$BACKUP/code-before.tar.gz"
if [[ -d dist ]]; then tar -czpf "$BACKUP/dist-before.tar.gz" dist; fi
printf 'Service: %s | User OS: %s | DB: %s\nBackup: %s\n' "$SERVICE" "$SERVICE_USER" "$DB" "$BACKUP"

printf '\n[2/6] Maintenance: menghentikan service dan memeriksa penulis DB...\n'
STOPPED=1
systemctl stop "$SERVICE"
[[ "$(systemctl show "$SERVICE" -p MainPID --value)" == 0 ]] || fail 'PID service masih hidup.'
# Gagal tertutup bila ada proses lain yang masih membuka DB/WAL/SHM.
"$NODE" --input-type=module - "$DB" <<'NODE_WRITERS'
import fs from 'node:fs';
const wanted=new Set([process.argv[2],process.argv[2]+'-wal',process.argv[2]+'-shm']),found=[];
for(const pid of fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p))){let fds;try{fds=fs.readdirSync(`/proc/${pid}/fd`);}catch(e){if(e.code==='ENOENT')continue;throw e;}for(const fd of fds){try{if(wanted.has(fs.readlinkSync(`/proc/${pid}/fd/${fd}`)))found.push(pid);}catch(e){if(e.code!=='ENOENT'&&e.code!=='EINVAL')throw e;}}}
if(found.length)throw Error(`DB masih dibuka PID ${[...new Set(found)].join(', ')}. Hentikan penulis/pembaca lain dahulu.`);
NODE_WRITERS
SNAP=$(mktemp -d /tmp/fiberops-snapshot.XXXXXXXX)
chown "$UID_SERVICE:$GID_SERVICE" "$SNAP"
run_service "$NODE" "$TMP/backup.mjs" "$DB" "$SNAP/database.db"
install -o root -g root -m 600 "$SNAP/database.db" "$BACKUP/database.db"

cat >"$TMP/inventory.mjs" <<'NODE_INVENTORY'
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.argv[2],{readOnly:true}),out={};
try{for(const t of ['users','olts','olt_cards','olt_ports','odcs','odps','splitters','splitter_outputs','core_assignments','core_links','odc_feeder_ports','interface_mappings'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t))out[t]=db.prepare(`SELECT id FROM ${t} ORDER BY id`).all().map(r=>r.id);console.log(JSON.stringify(out));}finally{db.close();}
NODE_INVENTORY
chmod 644 "$TMP/inventory.mjs"
"$NODE" "$TMP/inventory.mjs" "$BACKUP/database.db" >"$BACKUP/inventory-before.json"
printf 'Snapshot SQLite konsisten tersimpan (termasuk transaksi WAL).\n'

printf '\n[3/6] Memperbarui kode dengan fast-forward dan build dari lockfile...\n'
[[ "$(run_code git rev-parse HEAD)" == "$OLD" && -z "$(run_code git status --porcelain)" ]] || fail 'Checkout berubah saat maintenance.'
run_code git merge --ff-only "$TARGET"
run_code npm ci --include=dev
run_code npm run build

printf '\n[4/6] Preflight DB sebelum startup (tidak mereset akun/inventaris)...\n'
run_service "$NODE" scripts/preflight.mjs "$DB" | tee "$BACKUP/preflight-before.log"
if grep -q '^CEK   ' "$BACKUP/preflight-before.log"; then
  printf '\nAda peringatan di atas. Jika perlu koreksi fisik/mapping, jangan lanjut.\n'
  read -r -p 'Setelah membaca peringatan, ketik LANJUT untuk startup: ' ANSWER </dev/tty
  [[ "$ANSWER" == LANJUT ]] || fail 'Startup ditunda atas pilihan operator.'
fi

printf '\n[5/6] Menyalakan service dan memeriksa health...\n'
systemctl start "$SERVICE"
curl --fail --silent --show-error --retry 15 --retry-delay 1 --retry-connrefused --retry-max-time 45 --max-time 3 "$HEALTH" >"$BACKUP/health.json"
systemctl is-active --quiet "$SERVICE" || fail 'Service tidak aktif setelah startup.'
"$NODE" -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(d.ok!==true||d.service!=="fiberops-arena-api")process.exit(1)' "$BACKUP/health.json"

printf '\n[6/6] Preflight ulang dan pemeriksaan ID inventaris...\n'
run_service "$NODE" scripts/preflight.mjs "$DB" | tee "$BACKUP/preflight-after.log"
run_service "$NODE" "$TMP/inventory.mjs" "$DB" >"$BACKUP/inventory-after.json"
"$NODE" --input-type=module - "$BACKUP/inventory-before.json" "$BACKUP/inventory-after.json" <<'NODE_COMPARE'
import fs from 'node:fs';
const [before,after]=process.argv.slice(2).map(p=>JSON.parse(fs.readFileSync(p,'utf8')));
for(const [table,ids] of Object.entries(before)){const current=new Set(after[table]||[]);if(ids.some(id=>!current.has(id)))throw Error(`Ada ID lama yang tidak ditemukan pada ${table}; tunda penggunaan dan periksa backup.`);}
console.log('Semua ID akun/inventaris sebelum update masih ditemukan. Ini bukan validasi kabel atau seluruh nilai field.');
NODE_COMPARE
systemctl status "$SERVICE" --no-pager --lines=8
STOPPED=0
printf '\nUPDATE SELESAI. Backup privat: %s\n' "$BACKUP"
printf 'Hard-refresh Ctrl+Shift+R, login dengan akun pribadi, lalu cek inventaris/jalur serta PDF/CSV.\n'
printf 'Salin backup ke storage lain. Jangan unggah database, file konfigurasi, atau kredensial ke chat.\n'
