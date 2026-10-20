// Snapshot konsisten melalui SQLite (termasuk WAL), bukan copy file .db saja.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
let source, snapshot;
try {
  if (process.argv.length !== 4) throw Error("Gunakan: node scripts/backup.mjs /path/source.db /path/backup-baru.db");
  const input = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
  if (!fs.existsSync(input)) throw Error("Database sumber tidak ditemukan; periksa path/volume.");
  if (fs.existsSync(output)) throw Error("Tujuan sudah ada. Backup lama tidak ditimpa; gunakan nama baru.");
  process.umask(0o077); fs.mkdirSync(path.dirname(output), { recursive: true });
  source = new DatabaseSync(input, { readOnly: true });
  source.exec("PRAGMA busy_timeout=10000");
  source.exec(`VACUUM INTO '${output.replaceAll("'", "''")}'`);
  snapshot = new DatabaseSync(output, { readOnly: true });
  const result = snapshot.prepare("PRAGMA quick_check").all();
  if (result.length !== 1 || result[0].quick_check !== "ok") throw Error("Salinan tidak lolos quick_check; jangan gunakan untuk restore.");
  console.log(`Backup konsisten selesai, quick_check=ok: ${output}`);
} catch (error) { console.error(`BACKUP GAGAL: ${error.message}`); process.exitCode = 1; }
finally { snapshot?.close(); source?.close(); }
