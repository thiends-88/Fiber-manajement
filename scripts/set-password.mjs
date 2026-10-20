// Rotasi/reset lokal yang mempertahankan ID, email, nama dan role akun yang ada.
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
  const {email,password} = await passwordInput("set-password.mjs");
  if (!fs.existsSync(file)) throw Error("Database tidak ditemukan; akun/database baru tidak dibuat.");
  process.umask(0o077);
  db = new DatabaseSync(file); db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  const account = db.prepare("SELECT id FROM users WHERE email=?").get(email);
  if (!account) throw Error("Email tidak terdaftar; tidak ada akun yang diubah.");
  const hasSessions = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions'").get();
  const passwordHash = hashPassword(password);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(passwordHash,account.id);
    if (hasSessions) db.prepare("DELETE FROM sessions WHERE user_id=?").run(account.id);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  console.log(`Password ${email} diperbarui dan sesi akun dicabut. ID/nama/role/inventaris tidak diubah. Restart layanan bila sedang berjalan agar status blokir akun dimuat ulang.`);
} catch (error) { console.error(`GAGAL: ${error.message}`); process.exitCode=1; }
finally { db?.close(); }
