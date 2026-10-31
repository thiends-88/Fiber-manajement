// Seluruh skenario menggunakan DB/proses sementara; tidak membaca DB pengguna.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { buildNetworkMap, filterNetworkMap } from "../src/lib/network-map.js";
const ROOT = path.resolve(import.meta.dirname, ".."),
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-map-api-")),
  DB = path.join(TMP, "map.db");
const PORT = Number(process.env.UJI_MAP_API_PORT || 4801),
  BASE = `http://127.0.0.1:${PORT}`;
let app,
  token,
  passed = 0,
  failed = 0;
const pending = new Set(),
  gpsColumns = ["latitude", "longitude", "coordinate_mode"];
const digest = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function sql(fn) {
  const db = new DatabaseSync(DB);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function snapshot() {
  return sql((db) =>
    Object.fromEntries(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map(({ name }) => [
          name,
          {
            columns: db
              .prepare("SELECT name FROM pragma_table_info(?)")
              .all(name)
              .map((c) => c.name),
            rows: db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all(),
          },
        ]),
    ),
  );
}
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log("OK   ", name);
  } catch (e) {
    failed++;
    console.error("GAGAL", name, "—", e.message);
  }
}
async function start(mustFail = false) {
  let log = "";
  app = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "development",
      ARENA_API_PORT: String(PORT),
      ARENA_API_HOST: "127.0.0.1",
      ARENA_DB_PATH: DB,
      ARENA_PUBLIC_ORIGIN: BASE,
      ARENA_SECURE_COOKIES: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error(`Startup timeout: ${log}`)),
      15000,
    );
    const append = (d) => {
      log += d;
      if (!mustFail && log.includes("siap di")) {
        clearTimeout(timer);
        resolve(log);
      }
    };
    app.stdout.on("data", append);
    app.stderr.on("data", append);
    app.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    app.once("exit", (code) => {
      clearTimeout(timer);
      mustFail && code !== 0
        ? resolve(log)
        : reject(Error(`Server berhenti ${code}: ${log}`));
    });
  });
}
async function stop() {
  if (app && app.exitCode == null && app.signalCode == null) {
    const done = once(app, "exit");
    app.kill();
    await done;
  }
  app = null;
}
async function request(method, route, body, auth = token) {
  const response = await fetch(BASE + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { response, data, text };
}
async function call(
  method,
  route,
  body,
  status = method === "POST" ? 201 : 200,
  auth = token,
) {
  const result = await request(method, route, body, auth);
  assert.equal(
    result.response.status,
    status,
    `${method} ${route}: ${result.text}`,
  );
  return result.data;
}
async function login(email, password) {
  return call("POST", "/api/login", { email, password }, 200, null);
}
async function slow(route, auth = token) {
  let done, fail;
  const result = new Promise((resolve, reject) => {
    done = resolve;
    fail = reject;
  });
  const req = http.request(
    BASE + route,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${auth}`,
        "content-type": "application/json",
        "transfer-encoding": "chunked",
        expect: "100-continue",
      },
    },
    (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        pending.delete(req);
        done({ status: res.statusCode, data: JSON.parse(data) });
      });
    },
  );
  pending.add(req);
  req.on("error", fail);
  req.flushHeaders();
  await once(req, "continue");
  await new Promise((resolve) => req.write('{"latitude":', resolve));
  await call("GET", "/healthz", undefined, 200, null);
  return (value) => {
    req.end(`${value}}`);
    return result;
  };
}
const ownerEmail = "owner-map@test.local",
  ownerPassword = "PrivateMapOwner123!";
try {
  console.log("\n=== MIGRASI KOORDINAT / SNAPSHOT PETA / API GPS ===");
  await start();
  token = (await login("admin@arena.test", "Arena123!")).token;
  const owner = await call("POST", "/api/users", {
    email: ownerEmail,
    password: ownerPassword,
    full_name: "Akun privat fixture",
    role: "admin",
  });
  const operator = await call("POST", "/api/users", {
    email: "operator-map@test.local",
    password: "MapOperator123!",
    full_name: "Operator fixture",
    role: "operator",
  });
  await call("POST", "/api/users", {
    email: "reader-map@test.local",
    password: "MapReader123!",
    full_name: "Pembaca fixture",
    role: "user",
  });
  const olt = await call("POST", "/api/olts", {
    name: "OLT-LEGACY-GPS",
    olt_type: "ZTE C300",
    location: "-0.79, 100.64",
    notes: "Alamat/ID harus utuh",
  });
  const manualOlt = await call("POST", "/api/olts", {
    name: "OLT-UNKNOWN-LEGACY",
    olt_type: "Merek Manual Lama",
    interface_mode: "custom",
    location: "Alamat model manual",
    fixed_port_count: 4,
  });
  const odc = await call("POST", "/api/odcs", {
    name: "ODC-LEGACY-GPS",
    olt_id: olt.id,
    cable_type: "48_core_4_tube",
    location: "-0.81,100.65",
  });
  const odp = await call("POST", "/api/odps", {
    name: "ODP-LEGACY-GPS",
    odc_id: odc.id,
    cable_type: "12_core_2_tube",
    location: "-0.82,100.66",
  });
  await stop();
  // Simulasi skema sebelum fitur GPS pada salinan uji saja. Tidak ada DROP di migrasi aplikasi.
  sql((db) => {
    for (const table of ["olts", "odcs", "odps"]) {
      for (const column of gpsColumns)
        db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      db.exec(`ALTER TABLE ${table} ADD COLUMN asset_tag TEXT`);
      db.exec(`UPDATE ${table} SET asset_tag='tag-' || id`);
    }
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
      crypto.createHash("sha256").update(ownerPassword).digest("hex"),
      owner.id,
    );
  });
  const legacy = snapshot();
  await start();
  await check(
    "migrasi aditif mempertahankan seluruh kolom/row/ID/timestamp/akun lama",
    () => {
      const after = snapshot();
      for (const [table, before] of Object.entries(legacy)) {
        const oldValues = after[table].rows.map((row) =>
          Object.fromEntries(before.columns.map((key) => [key, row[key]])),
        );
        assert.equal(
          digest(oldValues),
          digest(before.rows),
          `Isi lama berubah: ${table}`,
        );
        if (["olts", "odcs", "odps"].includes(table)) {
          assert.equal(after[table].columns.length, before.columns.length + 3);
          assert.ok(
            after[table].rows.every(
              (row) =>
                row.latitude === null &&
                row.longitude === null &&
                row.coordinate_mode === "location",
            ),
          );
        } else assert.deepEqual(after[table].columns, before.columns);
      }
      sql((db) => {
        assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
        assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
      });
    },
  );
  await check(
    "restart idempoten tidak merotasi akun/sesi atau menulis koordinat contoh",
    async () => {
      const before = digest(snapshot());
      await stop();
      await start();
      assert.equal(digest(snapshot()), before);
    },
  );
  await check(
    "snapshot terlindungi; token query URL tidak dipakai untuk autentikasi",
    async () => {
      await call("GET", "/api/map-data", undefined, 401, null);
      await call(
        "GET",
        `/api/map-data?token=${encodeURIComponent(token)}`,
        undefined,
        401,
        null,
      );
    },
  );
  await check(
    "GET peta read-only dan tidak mengirim tabel autentikasi",
    async () => {
      const before = digest(snapshot()),
        result = await request("GET", "/api/map-data");
      assert.equal(result.response.status, 200);
      assert.match(result.response.headers.get("cache-control"), /no-store/);
      assert.deepEqual(
        Object.keys(result.data).sort(),
        [
          "version",
          "olts",
          "odcs",
          "odps",
          "ports",
          "feederPorts",
          "interfaceMappings",
          "links",
          "splitters",
        ].sort(),
      );
      assert.equal(result.data.version, 1);
      assert.ok(!result.text.includes("password_hash"));
      assert.ok(!result.text.includes(ownerEmail));
      for (const [table, key] of [
        ["olts", "olts"],
        ["odcs", "odcs"],
        ["odps", "odps"],
        ["olt_ports", "ports"],
        ["core_links", "links"],
        ["interface_mappings", "interfaceMappings"],
      ])
        assert.deepEqual(
          result.data[key].map((r) => r.id).sort((a, b) => a - b),
          sql((db) =>
            db
              .prepare(`SELECT id FROM ${table} ORDER BY id`)
              .all()
              .map((r) => r.id),
          ),
        );
      assert.ok(result.data.splitters.every((s) => Array.isArray(s.outputs)));
      assert.equal(digest(snapshot()), before);
      const view = filterNetworkMap(buildNetworkMap(result.data));
      assert.equal(view.points.length, 3);
      assert.ok(
        !view.points.some(
          (n) => n.coordinates.latitude === 0 || n.coordinates.longitude === 0,
        ),
      );
    },
  );
  await check(
    "GPS valid tetap terbaca saat induk inventaris legacy hilang, tanpa memperbaiki data diam-diam",
    async () => {
      // Simulasikan impor legacy dengan FK rusak hanya pada DB fixture.
      const ids = sql((db) => {
        db.exec("PRAGMA foreign_keys=OFF");
        return {
          odc: Number(
            db
              .prepare(
                "INSERT INTO odcs (olt_id,name,cable_type,latitude,longitude,coordinate_mode) VALUES (999999,'ODC-INDUK-HILANG','12_core_2_tube',-0.93,100.7,'manual')",
              )
              .run().lastInsertRowid,
          ),
          odp: Number(
            db
              .prepare(
                "INSERT INTO odps (odc_id,name,cable_type,latitude,longitude,coordinate_mode) VALUES (999999,'ODP-INDUK-HILANG','12_core_2_tube',-0.94,100.71,'manual')",
              )
              .run().lastInsertRowid,
          ),
        };
      });
      try {
        const before = digest(snapshot());
        const data = await call("GET", "/api/map-data");
        assert.ok(
          data.odcs.some((row) => row.id === ids.odc),
          "ODC tidak boleh hilang karena induknya tidak ada",
        );
        assert.ok(
          data.odps.some((row) => row.id === ids.odp),
          "ODP tidak boleh hilang karena induknya tidak ada",
        );
        const view = filterNetworkMap(buildNetworkMap(data));
        for (const key of [`odc-${ids.odc}`, `odp-${ids.odp}`]) {
          const point = view.points.find((node) => node.key === key);
          assert.ok(point, `GPS valid tidak dipetakan: ${key}`);
          assert.equal(point.oltName, "Induk belum diketahui");
          assert.ok(
            !view.lines.some(
              (line) => line.from.key === key || line.to.key === key,
            ),
            "Induk hilang bukan bukti sambungan",
          );
        }
        assert.equal(digest(snapshot()), before);
      } finally {
        sql((db) => {
          db.exec("PRAGMA foreign_keys=OFF");
          db.prepare("DELETE FROM odps WHERE id=?").run(ids.odp);
          db.prepare("DELETE FROM odcs WHERE id=?").run(ids.odc);
        });
      }
    },
  );
  await check(
    "hash lama akun privat tetap hingga login benar, lalu di-upgrade tanpa ganti identitas",
    async () => {
      const row = () =>
        sql((db) => db.prepare("SELECT * FROM users WHERE id=?").get(owner.id));
      const before = row();
      assert.match(before.password_hash, /^[a-f0-9]{64}$/);
      await call(
        "POST",
        "/api/login",
        { email: ownerEmail, password: "PasswordSalah123!" },
        401,
        null,
      );
      assert.equal(digest(row()), digest(before));
      await login(ownerEmail, ownerPassword);
      const after = row();
      assert.match(after.password_hash, /^scrypt\$/);
      assert.equal(after.id, before.id);
      assert.equal(after.role, before.role);
      assert.equal(after.created_at, before.created_at);
    },
  );
  const operatorSession = await login(
      "operator-map@test.local",
      "MapOperator123!",
    ),
    readerSession = await login("reader-map@test.local", "MapReader123!");
  await check(
    "admin/operator/pembaca dapat membaca snapshot, pembaca tidak dapat mengubah GPS",
    async () => {
      for (const auth of [token, operatorSession.token, readerSession.token])
        assert.equal(
          (await call("GET", "/api/map-data", undefined, 200, auth)).version,
          1,
        );
      for (const [table, row] of [
        ["olts", olt],
        ["odcs", odc],
        ["odps", odp],
      ])
        await call(
          "PATCH",
          `/api/${table}/${row.id}`,
          { latitude: 0, longitude: 0 },
          403,
          readerSession.token,
        );
    },
  );
  const cases = [
    [
      "olts",
      { name: "OLT-GPS-API", olt_type: "ZTE C320", location: "Alamat baru" },
    ],
    [
      "odcs",
      {
        name: "ODC-GPS-API",
        olt_id: olt.id,
        cable_type: "48_core_4_tube",
        location: "Alamat baru",
      },
    ],
    [
      "odps",
      {
        name: "ODP-GPS-API",
        odc_id: odc.id,
        cable_type: "12_core_2_tube",
        location: "Alamat baru",
      },
    ],
  ];
  for (const [table, base] of cases) {
    await check(
      `POST ${table} menerima GPS desimal koma/manual dan menyimpan angka nullable`,
      async () => {
        const saved = await call(
          "POST",
          `/api/${table}`,
          { ...base, latitude: "-0,71", longitude: "100,61" },
          201,
          operatorSession.token,
        );
        assert.equal(saved.coordinate_mode, "manual");
        assert.equal(saved.latitude, -0.71);
        assert.equal(saved.longitude, 100.61);
        assert.equal(saved.location, base.location);
      },
    );
    await check(
      `POST/PATCH ${table} menolak pasangan/rentang/mode buruk tanpa write parsial`,
      async () => {
        const target = table === "olts" ? olt : table === "odcs" ? odc : odp;
        for (const invalid of [
          { latitude: 0 },
          { latitude: "", longitude: 100 },
          { latitude: false, longitude: 0 },
          { latitude: [], longitude: 0 },
          { latitude: 91, longitude: 0 },
          { latitude: 0, longitude: 181 },
          { coordinate_mode: "none", latitude: 0, longitude: 0 },
          { coordinate_mode: "manual", latitude: null, longitude: null },
          { coordinate_mode: "garbage" },
        ]) {
          const before = digest(snapshot());
          await call("POST", `/api/${table}`, { ...base, ...invalid }, 400);
          assert.equal(digest(snapshot()), before);
          await call("PATCH", `/api/${table}/${target.id}`, invalid, 400);
          assert.equal(digest(snapshot()), before);
        }
      },
    );
    await check(
      `GPS-only ${table} mempertahankan lokasi/kolom tambahan/relasi dan tabel lain`,
      async () => {
        const target =
          table === "olts" ? manualOlt : table === "odcs" ? odc : odp;
        const before = snapshot();
        await call(
          "PATCH",
          `/api/${table}/${target.id}`,
          { coordinate_mode: "manual", latitude: 0, longitude: 100.65 },
          200,
          operatorSession.token,
        );
        const after = snapshot();
        for (const name of Object.keys(before)) {
          const project = (rows) =>
            rows.map((row) =>
              name === table && row.id === target.id
                ? Object.fromEntries(
                    Object.entries(row).filter(
                      ([key]) => ![...gpsColumns, "updated_at"].includes(key),
                    ),
                  )
                : row,
            );
          assert.equal(
            digest(project(after[name].rows)),
            digest(project(before[name].rows)),
            `Efek samping pada ${name}`,
          );
        }
      },
    );
    await check(
      `PATCH non-GPS ${table} tidak menghapus pasangan manual/nol`,
      async () => {
        const target =
          table === "olts" ? manualOlt : table === "odcs" ? odc : odp;
        const result = await call("PATCH", `/api/${table}/${target.id}`, {
          notes: "Catatan baru tanpa reset GPS",
        });
        assert.equal(result.latitude, 0);
        assert.equal(result.longitude, 100.65);
        assert.equal(result.coordinate_mode, "manual");
      },
    );
    await check(
      `mode none/location ${table} mempertahankan Lokasi dan mengendalikan fallback`,
      async () => {
        const target = table === "olts" ? olt : table === "odcs" ? odc : odp;
        const none = await call("PATCH", `/api/${table}/${target.id}`, {
          latitude: null,
          longitude: null,
        });
        assert.equal(none.coordinate_mode, "none");
        assert.equal(none.location, target.location);
        let view = filterNetworkMap(
          buildNetworkMap(await call("GET", "/api/map-data")),
        );
        assert.ok(
          !view.points.some(
            (n) => n.kind + "s" === table && n.id === target.id,
          ),
        );
        const legacy = await call("PATCH", `/api/${table}/${target.id}`, {
          coordinate_mode: "location",
        });
        assert.equal(legacy.latitude, null);
        assert.equal(legacy.longitude, null);
        assert.equal(legacy.location, target.location);
        view = filterNetworkMap(
          buildNetworkMap(await call("GET", "/api/map-data")),
        );
        assert.ok(
          view.points.some((n) => n.kind + "s" === table && n.id === target.id),
        );
      },
    );
  }
  await check(
    "ODP tetap splitter 1:8; GPS tidak membuat card/port/sumber pemetaan baru",
    async () => {
      const before = snapshot();
      await call("PATCH", `/api/odps/${odp.id}`, {
        latitude: -0.72,
        longitude: 100.65,
      });
      const after = snapshot();
      for (const name of [
        "olt_cards",
        "olt_ports",
        "odc_feeder_ports",
        "interface_mappings",
        "splitters",
        "splitter_outputs",
        "core_links",
      ])
        assert.equal(digest(after[name]), digest(before[name]));
      const splitters = await call("GET", `/api/splitters?odp_id=${odp.id}`);
      assert.equal(splitters[0].ratio, "1:8");
      assert.equal(splitters[0].outputs.length, 8);
    },
  );
  await check(
    "GPS-only tidak dipaksa merapikan kabel legacy yang bermasalah",
    async () => {
      sql((db) =>
        db
          .prepare(
            "UPDATE odcs SET cable_type='legacy-unknown-cable' WHERE id=?",
          )
          .run(odc.id),
      );
      try {
        const row = await call("PATCH", `/api/odcs/${odc.id}`, {
          latitude: -0.73,
          longitude: 100.65,
        });
        assert.equal(row.cable_type, "legacy-unknown-cable");
      } finally {
        sql((db) =>
          db
            .prepare("UPDATE odcs SET cable_type=? WHERE id=?")
            .run(odc.cable_type, odc.id),
        );
      }
    },
  );
  await check(
    "PATCH GPS tertunda memakai pasangan/nama terbaru tanpa lost update metadata",
    async () => {
      await call("PATCH", `/api/olts/${olt.id}`, {
        latitude: -0.7,
        longitude: 100,
      });
      const finish = await slow(`/api/olts/${olt.id}`);
      await call("PATCH", `/api/olts/${olt.id}`, { longitude: 101 });
      await call("PATCH", `/api/olts/${olt.id}`, { name: "Nama diubah peer" });
      const result = await finish(-0.75);
      assert.equal(result.status, 200);
      assert.equal(result.data.latitude, -0.75);
      assert.equal(result.data.longitude, 101);
      assert.equal(result.data.name, "Nama diubah peer");
    },
  );
  await check(
    "hak operator yang dicabut selama upload membatalkan PATCH GPS",
    async () => {
      const before = sql((db) =>
        db.prepare("SELECT * FROM odps WHERE id=?").get(odp.id),
      );
      const finish = await slow(`/api/odps/${odp.id}`, operatorSession.token);
      await call("PATCH", `/api/users/${operator.id}`, { role: "user" });
      const result = await finish(-0.76);
      assert.equal(result.status, 403);
      assert.equal(
        digest(
          sql((db) => db.prepare("SELECT * FROM odps WHERE id=?").get(odp.id)),
        ),
        digest(before),
      );
    },
  );
  await check(
    "kegagalan statement GPS mengembalikan seluruh pasangan, mode, timestamp",
    async () => {
      const before = digest(snapshot());
      sql((db) =>
        db.exec(
          "CREATE TRIGGER map_fail_gps BEFORE UPDATE OF latitude ON olts BEGIN SELECT RAISE(ABORT,'GPS fixture failure'); END",
        ),
      );
      try {
        await call(
          "PATCH",
          `/api/olts/${olt.id}`,
          { latitude: -0.77, longitude: 100 },
          500,
        );
        assert.equal(digest(snapshot()), before);
      } finally {
        sql((db) => db.exec("DROP TRIGGER map_fail_gps"));
      }
    },
  );
  await check(
    "mode none tetap setelah restart meskipun Lokasi memuat koordinat lama",
    async () => {
      await call("PATCH", `/api/odps/${odp.id}`, { coordinate_mode: "none" });
      await stop();
      await start();
      const data = await call("GET", "/api/map-data");
      const row = data.odps.find((r) => r.id === odp.id);
      assert.equal(row.coordinate_mode, "none");
      assert.equal(row.location, odp.location);
      assert.ok(
        !filterNetworkMap(buildNetworkMap(data)).points.some(
          (n) => n.key === `odp-${odp.id}`,
        ),
      );
    },
  );
  await check(
    "migrasi gagal di tabel kedua rollback skema/data, tanpa reset akun/inventaris",
    async () => {
      await stop();
      sql((db) => {
        for (const table of ["olts", "odcs", "odps"])
          for (const column of gpsColumns)
            db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
        db.exec(
          "ALTER TABLE odcs ADD COLUMN latitude REAL; ALTER TABLE odcs ADD COLUMN longitude REAL",
        );
        db.prepare(
          "UPDATE odcs SET latitude=-0.78, longitude=100.65 WHERE id=?",
        ).run(odc.id);
        db.exec(
          "CREATE TRIGGER map_fail_migration BEFORE UPDATE ON odcs BEGIN SELECT RAISE(ABORT,'Migration fixture failure'); END",
        );
      });
      const before = digest(snapshot()),
        log = await start(true);
      assert.match(log, /Migrasi koordinat gagal; data lama tidak direset/);
      assert.equal(digest(snapshot()), before);
      sql((db) => db.exec("DROP TRIGGER map_fail_migration"));
      await start();
      const row = sql((db) =>
        db.prepare("SELECT * FROM odcs WHERE id=?").get(odc.id),
      );
      assert.equal(row.latitude, -0.78);
      assert.equal(row.longitude, 100.65);
      assert.equal(row.coordinate_mode, "manual");
      assert.equal(
        sql(
          (db) =>
            db
              .prepare("SELECT COUNT(*) AS n FROM users WHERE id=? AND email=?")
              .get(owner.id, ownerEmail).n,
        ),
        1,
      );
    },
  );
  console.log(`\nPETA API/MIGRASI: ${passed} lulus, ${failed} gagal.`);
  if (failed) process.exitCode = 1;
} finally {
  for (const req of pending) req.destroy();
  await stop();
  fs.rmSync(TMP, { recursive: true, force: true });
}
