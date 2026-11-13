// DATA SINTETIS KHUSUS UJI UPDATE. Tidak pernah diimpor aplikasi/server pengguna.
// Nama, alamat, IP TEST-NET dan koordinat di sini bukan inventaris/GPS lapangan.
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "../../server/security.mjs";
export const accounts = {
  owner: "owner@upgrade-fixture.test",
  operator: "operator@upgrade-fixture.test",
  reader: "reader@upgrade-fixture.test",
};
export const factoryPassword = "Arena123!";
const stamp = "2026-10-01 12:34:56";
export function existingUpdateData(file, { model = "ZTE C300", ownerPassword, factory = true, modern = false } = {}) {
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    const legacyHash = value => crypto.createHash("sha256").update(value).digest("hex");
    db.prepare("UPDATE users SET password_hash=?,full_name=? WHERE email=?")
      .run(legacyHash(ownerPassword), "Pemilik uji — data sintesis", accounts.owner);
    const user = db.prepare("INSERT INTO users(id,email,password_hash,full_name,role,created_at) VALUES(?,?,?,?,?,?)");
    user.run(501, accounts.operator, legacyHash(factory ? factoryPassword : "OperatorFixturePrivate123!"), "Operator uji", "operator", stamp);
    user.run(509, accounts.reader, hashPassword(factory ? factoryPassword : "ReaderFixturePrivate123!"), "Pembaca uji", "user", stamp);
    for (const table of ["olts", "odcs", "odps"]) db.exec(`ALTER TABLE ${table} ADD COLUMN asset_tag TEXT`);
    db.exec('CREATE TABLE field_records (id INTEGER PRIMARY KEY, "catatan petugas" TEXT, payload BLOB, precise INTEGER)');
    db.prepare('INSERT INTO field_records VALUES(?,?,?,?)').run(17, "UJI: jangan reset catatan 'lama' / 🌏", new Uint8Array([0, 255, 42]), 1152921504606846976n);
    db.prepare("INSERT INTO olts(id,name,olt_type,location,ip,notes,interface_mode,created_at,updated_at,asset_tag) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(41, "OLT-UJI-PELESTARIAN", model, "-0.7900, 100.6400", "192.0.2.41", "SINTETIS, bukan lokasi lapangan", "shelf_slot_port", stamp, stamp, "ASSET-UJI-OLT");
    const sizes = model === "ZTE C300" ? [16, 16, 16, 16, 8, 8] : [8, 8];
    const card = db.prepare("INSERT INTO olt_cards(id,olt_id,shelf,slot,card_type,label,port_count,is_builtin,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    const port = db.prepare("INSERT INTO olt_ports(id,card_id,port,status,sfp,serial,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)");
    let serial = 0;
    for (const [i, size] of sizes.entries()) {
      const id = 101 + i * 3;
      card.run(id, 41, i < 4 ? 1 : 2, i < 4 ? i + 1 : i - 3, "OTHER", `Card uji ${i + 1}`, size, 0, "Kapasitas eksplisit fixture, bukan spesifikasi hardware", stamp, stamp);
      for (let n = 1; n <= size; n++) {
        port.run(2001 + serial * 2, id, n, ["active", "inactive", "reserved", "damaged"][serial % 4], "SFP-UJI", `SERIAL-UJI-${serial}`, "Catatan port lama", stamp, stamp);
        serial++;
      }
    }
    const odcCount = model === "ZTE C300" ? 62 : 5;
    const cabinet = db.prepare("INSERT INTO odcs(id,olt_id,name,location,cable_type,notes,created_at,updated_at,asset_tag) VALUES(?,?,?,?,?,?,?,?,?)");
    for (let i = 0; i < odcCount; i++) {
      cabinet.run(1001 + i * 7, 41, i < 2 ? "ODC-NAMA-SAMA-UJI" : `ODC-UJI-${String(i + 1).padStart(3, "0")}`, i % 2 ? `Alamat sintetis No. ${i + 1} / lantai 2` : "-0.8100,100.6500", "48_core_4_tube", `Catatan input lama ${i} — & ' \"`, stamp, stamp, `ASSET-UJI-${i}`);
    }
    // Penghitung ID harus tetap di atas ID yang pernah dihapus, bukan hanya MAX(id) saat ini.
    cabinet.run(99991, 41, "ODC-UJI-SEMENTARA-DIHAPUS", "Uji sequence saja", "48_core_4_tube", "", stamp, stamp, "TEMP-UJI");
    db.prepare("DELETE FROM odcs WHERE id=99991").run();
    const distribution = db.prepare("INSERT INTO odps(id,odc_id,name,location,cable_type,notes,created_at,updated_at,asset_tag) VALUES(?,?,?,?,?,?,?,?,?)");
    distribution.run(8001, 1001, "ODP-UJI-001", "-0.8200,100.6600", "12_core_2_tube", "Alamat & catatan uji dipertahankan", stamp, stamp, "ASSET-ODP-A");
    distribution.run(8011, 1008, "ODP-UJI-002", "Tiang sintetis — bukan GPS", "12_core_2_tube", "Pelanggan UJI saja", stamp, stamp, "ASSET-ODP-B");
    // Kolom ekstensi lama sengaja disimpan; updater tidak boleh membersihkannya.
    db.exec("ALTER TABLE splitters ADD COLUMN input_splitter_id INTEGER; ALTER TABLE splitters ADD COLUMN input_power REAL");
    const splitter = db.prepare("INSERT INTO splitters(id,odc_id,odp_id,name,ratio,input_core,input_note,notes,created_at,updated_at,input_splitter_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    splitter.run(9001, 1001, null, "SPL-UJI-ROOT", "1:4", 1, "Input lama", "Root uji", stamp, stamp, null);
    splitter.run(9003, 1001, null, "SPL-UJI-CASCADE", "1:4", 1, "Catatan cascade lama", "Jangan merapikan input otomatis", stamp, stamp, 9001);
    splitter.run(9010, 1008, null, "SPL-UJI-RECEIVER", "1:4", 1, "Receiver eksplisit", "ID penerima harus tetap", stamp, stamp, null);
    splitter.run(9020, 1015, null, "SPL-UJI-BELUM-DIPILIH", "1:4", 1, "Belum ada bukti", "Receiver sengaja kosong", stamp, stamp, null);
    splitter.run(9101, null, 8001, "SPL-UJI-ODP-A", "1:8", 1, null, "Permanen 1:8", stamp, stamp, null);
    splitter.run(9102, null, 8011, "SPL-UJI-ODP-B", "1:8", 1, null, "Permanen 1:8", stamp, stamp, null);
    db.exec("UPDATE splitters SET input_power=-15.75 WHERE id=9003");
    const output = db.prepare("INSERT INTO splitter_outputs(id,splitter_id,port,target_type,target_odp_id,target_splitter_id,target_odc_id,target_odc_core,target_odc_splitter_id,notes) VALUES(?,?,?,?,?,?,?,?,?,?)");
    let next = 20001;
    for (const [id, count] of [[9001, 4], [9003, 4], [9010, 4], [9020, 4], [9101, 8], [9102, 8]]) {
      for (let n = 1; n <= count; n++) {
        let target = null, odp = null, child = null, odc = null, core = null, receiver = null;
        if (id === 9001 && n === 1) { target = "splitter"; child = 9003; }
        if (id === 9001 && n === 2) { target = "odc"; odc = 1008; core = 1; receiver = 9010; }
        if (id === 9001 && n === 3) { target = "odc"; odc = 1015; core = 1; }
        if (id === 9003 && n === 1) { target = "odp"; odp = 8001; }
        output.run(next++, id, n, target, odp, child, odc, core, receiver, "Bukti uji, tidak boleh ditebak ulang");
      }
    }
    db.prepare("INSERT INTO odc_feeder_ports(id,odc_id,port_id,created_at) VALUES(?,?,?,?)").run(301, 1001, 2001, stamp);
    db.prepare("INSERT INTO interface_mappings(id,odc_id,core,port_id,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(701, 1001, 1, 2001, "Interface → core eksplisit", stamp, stamp);
    db.prepare("INSERT INTO core_assignments(id,source,odc_id,odp_id,core,status,customer,destination,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(403, "olt_to_odc", 1001, null, 1, "used", "Pelanggan sintetis", "Ke splitter UJI", "Jangan reset label", stamp, stamp);
    db.prepare("INSERT INTO core_links(id,odc_id,odc_core,odp_id,odp_core,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(601, 1001, 2, 8011, 2, "Link eksplisit fixture", stamp, stamp);
    if (modern) {
      db.exec("UPDATE olts SET latitude=-0.79,longitude=100.64,coordinate_mode='manual'; UPDATE odcs SET latitude=-0.81,longitude=100.65,coordinate_mode='manual' WHERE id=1001; UPDATE odcs SET coordinate_mode='none' WHERE id=1008; UPDATE odps SET latitude=-0.82,longitude=100.66,coordinate_mode='manual' WHERE id=8001;");
      db.prepare("INSERT INTO map_route_imports(id,name,source_name,source_format,content_hash,warnings,route_count,vertex_count,bounds,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(71, "Jalur uji saja", "synthetic-upgrade.csv", "CSV", crypto.createHash("sha256").update("route-UJI-sintetis").digest("hex"), "[]", 1, 3, "[100.64,-0.82,100.66,-0.79]", stamp);
      db.prepare("INSERT INTO map_route_segments(id,import_id,ordinal,name,description,folder,color,coordinates,vertex_count,bounds) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(97, 71, 0, "Rute sintetis", "Bukan jalur optik terverifikasi", "Folder UJI", "#0088ff", "[[100.64,-0.79],[100.65,-0.81],[100.66,-0.82]]", 3, "[100.64,-0.82,100.66,-0.79]");
    }
    db.exec("COMMIT");
    return { olts: 1, cards: sizes.length, ports: serial, odcs: odcCount, odps: 2 };
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  finally { db.close(); }
}
