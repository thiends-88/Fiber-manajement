// Jalankan secara lokal di server; password dibaca dari stdin, bukan argv/log.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "../server/security.mjs";
import { passwordInput } from "./password-input.mjs";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = process.env.ARENA_DB_PATH || path.join(ROOT, "data", "fiberops.db");
let db;
try {
  const {email,password} = await passwordInput("create-admin.mjs");
  process.umask(0o077); fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file); db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','operator','user')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  if (db.prepare("SELECT id FROM users WHERE email=?").get(email)) throw Error("Email sudah terdaftar; tidak ada akun yang ditimpa. Gunakan email admin pribadi yang baru.");
  db.prepare("INSERT INTO users (email,password_hash,full_name,role) VALUES (?,?,?,'admin')").run(email,hashPassword(password),"Administrator");
  console.log(`Admin ${email} berhasil dibuat. Password dan akun lain tidak ditampilkan/diubah.`);
} catch (error) { console.error(`GAGAL: ${error.message}`); process.exitCode=1; }
finally { db?.close(); }
