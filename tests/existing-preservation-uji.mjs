// Unit read-only manifest: semua DB dibuat sementara; tidak membaca data aplikasi.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { snapshot, compare } from "../scripts/check-existing-update.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-preservation-unit-"));
const source = path.join(tmp, "baseline.db");
const db = new DatabaseSync(source);
db.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT,password_hash TEXT,role TEXT);
  INSERT INTO users VALUES(7,'unit@synthetic.test','SYNTHETIC-OPAQUE-HASH','admin');
  CREATE TABLE "inventory UJI"(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id INTEGER REFERENCES users(id),"catatan petugas" TEXT,payload BLOB,precise INTEGER);
  CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id INTEGER);
  CREATE TABLE security_migrations(name TEXT PRIMARY KEY);
  INSERT INTO sessions VALUES('SYNTHETIC-TOKEN',7);
  INSERT INTO security_migrations VALUES('SYNTHETIC-MIGRATION');
`);
db.prepare('INSERT INTO "inventory UJI" VALUES(?,?,?,?,?)').run(19, 7, "Nilai lama — Unicode 🌏", new Uint8Array([0, 255, 17]), 1152921504606846976n);
db.exec('INSERT INTO "inventory UJI"(id,owner_id) VALUES(900,7); DELETE FROM "inventory UJI" WHERE id=900');
db.close();
let passed = 0;
function check(name, test) {
  const file = path.join(tmp, `case-${passed}.db`);fs.copyFileSync(source, file);
  const before = snapshot(file);
  const mutate = sql => { const connection = new DatabaseSync(file);try { connection.exec(sql); } finally { connection.close(); } };
  test({ file, before, mutate });passed++;console.log(`OK ${name}`);
}
try {
  check("snapshot/compare read-only dan manifest tidak memuat nilai mentah/password/token", ({ file, before }) => {
    const bytes = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(compare(before, file).tablesChecked, 2);
    const json = JSON.stringify(before);
    for (const value of ["SYNTHETIC-OPAQUE-HASH", "SYNTHETIC-TOKEN", "unit@synthetic.test", "Nilai lama", "1152921504606846976"]) assert.ok(!json.includes(value));
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), bytes);
    assert.equal(before.sequences["inventory UJI"], "900");
  });
  check("schema/layer tambahan diizinkan tanpa mengabaikan kolom lama", ({ file, before, mutate }) => {
    mutate('ALTER TABLE "inventory UJI" ADD COLUMN additional_field TEXT; CREATE TABLE new_layer(id INTEGER PRIMARY KEY); INSERT INTO new_layer VALUES(1)');
    const result = compare(before, file);assert.deepEqual(result.addedTables, ["new_layer"]);assert.deepEqual(result.addedColumns, ["inventory UJI.additional_field"]);
  });
  check("perubahan teks lama ditolak tanpa mencetak nilai sensitif", ({ file, before, mutate }) => {
    mutate('UPDATE "inventory UJI" SET "catatan petugas"=\'RAHASIA-UJI-JANGAN-CETAK\'');
    assert.throws(() => compare(before, file), error => /Nilai\/ID lama berubah/.test(error.message) && !error.message.includes("RAHASIA-UJI"));
  });
  check("perubahan ID dengan jumlah baris sama ditolak", ({ file, before, mutate }) => {
    mutate('UPDATE "inventory UJI" SET id=20 WHERE id=19');assert.throws(() => compare(before, file), /Nilai\/ID lama berubah/);
  });
  check("penghapusan baris ditolak", ({ file, before, mutate }) => {
    mutate('DELETE FROM "inventory UJI"');assert.throws(() => compare(before, file), /Jumlah baris lama berubah/);
  });
  check("perubahan hash akun ditolak sebelum login", ({ file, before, mutate }) => {
    mutate("UPDATE users SET password_hash='NEW-SYNTHETIC-HASH'");assert.throws(() => compare(before, file), /Nilai\/ID lama berubah: users/);
  });
  check("perubahan role akun ditolak", ({ file, before, mutate }) => {
    mutate("UPDATE users SET role='operator'");assert.throws(() => compare(before, file), /Nilai\/ID lama berubah: users/);
  });
  check("BLOB tidak dinormalisasi menjadi teks", ({ file, before, mutate }) => {
    mutate('UPDATE "inventory UJI" SET payload=x\'00ff12\'');assert.throws(() => compare(before, file), /Nilai\/ID lama berubah/);
  });
  check("BigInt berbeda satu unit di atas Number.MAX_SAFE_INTEGER tetap terdeteksi", ({ file, before, mutate }) => {
    mutate('UPDATE "inventory UJI" SET precise=1152921504606846977');assert.throws(() => compare(before, file), /Nilai\/ID lama berubah/);
  });
  check("penghitung ID yang lebih besar dari MAX baris tersisa tidak boleh di-reset", ({ file, before, mutate }) => {
    mutate("UPDATE sqlite_sequence SET seq=19 WHERE name='inventory UJI'");assert.throws(() => compare(before, file), /Penghitung ID lama berubah/);
  });
  check("tabel/kolom custom lama tidak boleh dibuang", ({ file, before, mutate }) => {
    mutate('ALTER TABLE "inventory UJI" DROP COLUMN "catatan petugas"');assert.throws(() => compare(before, file), /Kolom lama hilang/);
    mutate('DROP TABLE "inventory UJI"');assert.throws(() => compare(before, file), /Tabel lama hilang/);
  });
  check("hanya sesi dan metadata migrasi keamanan dikecualikan secara eksplisit", ({ file, before, mutate }) => {
    mutate("DELETE FROM sessions; INSERT INTO security_migrations VALUES('NEW-SECURITY-METADATA')");assert.equal(compare(before, file).tablesChecked, 2);
  });
  check("FK rusak, akun kosong dan DB hilang ditolak tanpa membuat demo", ({ file, mutate }) => {
    mutate('PRAGMA foreign_keys=OFF; UPDATE "inventory UJI" SET owner_id=999');assert.throws(() => snapshot(file), /Foreign key gagal/);
    mutate('DELETE FROM "inventory UJI"; DELETE FROM users');assert.throws(() => snapshot(file), /Akun kosong/);
    const missing = path.join(tmp, "must-not-be-created.db");assert.throws(() => snapshot(missing), /Database tidak ada/);assert.ok(!fs.existsSync(missing));
  });
  console.log(`\nMANIFEST PELESTARIAN: ${passed} pemeriksaan lulus.\n`);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
