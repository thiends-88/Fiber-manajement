// Regresi audit 29-10-2026. Semua data/proses terisolasi; tidak memakai DB preview/produksi.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
const ROOT = path.resolve(import.meta.dirname, ".."),
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-audit-api-")),
  DB = path.join(TMP, "audit.db");
const PORT = Number(process.env.AUDIT_REGRESSION_PORT || 4988),
  BASE = `http://127.0.0.1:${PORT}`;
let child,
  token,
  passed = 0,
  failed = 0,
  log = "",
  serial = 0;
const pending = new Set();
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
async function request(method, url, body, auth = token) {
  const r = await fetch(BASE + url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: r.status, data, text };
}
async function call(
  method,
  url,
  body,
  status = method === "POST" ? 201 : 200,
  auth = token,
) {
  const r = await request(method, url, body, auth);
  assert.equal(r.status, status, `${method} ${url}: ${r.text}`);
  return r.data;
}
function sql(fn) {
  const db = new DatabaseSync(DB);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
async function actor(role = "operator") {
  const email = `actor-${++serial}@audit.test`,
    password = "ActorPrivatePassword123!";
  const u = await call("POST", "/api/users", {
    email,
    password,
    full_name: "Temporary actor",
    role,
  });
  const a = await call("POST", "/api/login", { email, password }, 200, null);
  return { ...u, token: a.token };
}
async function slow(method, url, start, auth = token) {
  let finish, reject;
  const done = new Promise((r, j) => {
    finish = r;
    reject = j;
  });
  const req = http.request(
    BASE + url,
    {
      method,
      headers: {
        authorization: `Bearer ${auth}`,
        "content-type": "application/json",
        "transfer-encoding": "chunked",
        expect: "100-continue",
      },
    },
    (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (text += d));
      res.on("end", () => {
        pending.delete(req);
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
        finish({ status: res.statusCode, text, data });
      });
    },
  );
  pending.add(req);
  req.on("error", (e) => {
    pending.delete(req);
    reject(e);
  });
  // 100 Continue dikirim server saat handler sudah dimulai; hindari race TCP baru
  // versus socket keep-alive peer (roundtrip health saja tidak cukup).
  req.flushHeaders();
  await once(req, "continue");
  await new Promise((resolve) => req.write(start, resolve));
  // Body belum lengkap saat mutasi peer dijalankan.
  await call("GET", "/healthz", undefined, 200, null);
  return {
    end: (tail) => {
      req.end(tail);
      return done;
    },
    cancel: () => req.destroy(),
  };
}
async function hardware() {
  const olt = await call("POST", "/api/olts", {
    name: `Audit OLT ${++serial}`,
    olt_type: "ZTE C300",
  });
  const card = await call("POST", "/api/cards", {
    olt_id: olt.id,
    shelf: 1,
    slot: 1,
    card_type: "GTHG",
    port_count: 8,
    label: "Label awal",
  });
  const port = await call("POST", "/api/ports", {
    card_id: card.id,
    port: 1,
    status: "active",
  });
  return { olt, card, port };
}
try {
  child = spawn(
    process.execPath,
    [process.env.AUDIT_SERVER_FILE || "server.mjs"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "development",
        ARENA_API_HOST: "127.0.0.1",
        ARENA_API_PORT: String(PORT),
        ARENA_DB_PATH: DB,
        ARENA_PUBLIC_ORIGIN: BASE,
        ARENA_SECURE_COOKIES: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Error(log)), 15000);
    child.stdout.on("data", (d) => {
      log += d;
      if (log.includes("siap di")) {
        clearTimeout(t);
        resolve();
      }
    });
    child.stderr.on("data", (d) => (log += d));
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(t);
      reject(Error("App exited " + code + ": " + log));
    });
  });
  token = (
    await call(
      "POST",
      "/api/login",
      { email: "admin@arena.test", password: "Arena123!" },
      200,
      null,
    )
  ).token;
  await check(
    "role yang dicabut saat body belum selesai tidak boleh melakukan write",
    async () => {
      const a = await actor(),
        name = `Tidak boleh role ${serial}`,
        q = await slow(
          "POST",
          "/api/olts",
          `{"name":${JSON.stringify(name)},"notes":`,
          a.token,
        );
      await call("PATCH", `/api/users/${a.id}`, { role: "user" });
      const r = await q.end('"pending"}');
      assert.equal(r.status, 403);
      assert.ok(!(await call("GET", "/api/olts")).some((o) => o.name === name));
    },
  );
  await check(
    "sesi akun yang dihapus saat body belum selesai ditolak",
    async () => {
      const a = await actor(),
        name = `Tidak boleh deleted ${serial}`,
        q = await slow(
          "POST",
          "/api/olts",
          `{"name":${JSON.stringify(name)},"notes":`,
          a.token,
        );
      await call("DELETE", `/api/users/${a.id}`);
      const r = await q.end('"pending"}');
      assert.equal(r.status, 401);
      assert.ok(!(await call("GET", "/api/olts")).some((o) => o.name === name));
    },
  );
  await check(
    "admin yang turun menjadi operator tidak dapat menyelesaikan request user-management tertunda",
    async () => {
      const a = await actor("admin"),
        email = `forbidden-${serial}@audit.test`,
        q = await slow(
          "POST",
          "/api/users",
          `{"email":${JSON.stringify(email)},"full_name":"Blocked","role":"user","password":`,
          a.token,
        );
      await call("PATCH", `/api/users/${a.id}`, { role: "operator" });
      const r = await q.end('"PrivatePassword123!"}');
      assert.equal(r.status, 403);
      assert.ok(
        !(await call("GET", "/api/users")).some((u) => u.email === email),
      );
    },
  );
  await check(
    "PATCH catatan lambat tidak menimpa label peer yang tidak dikirim di body",
    async () => {
      const { card } = await hardware(),
        q = await slow("PATCH", `/api/cards/${card.id}`, '{"notes":');
      await call("PATCH", `/api/cards/${card.id}`, {
        label: "Label peer terbaru",
      });
      const r = await q.end('"Catatan lambat"}');
      assert.equal(r.status, 200);
      assert.equal(r.data.label, "Label peer terbaru");
      assert.equal(r.data.notes, "Catatan lambat");
    },
  );
  await check(
    "record yang dihapus saat body PATCH tertunda harus 404, bukan sukses kosong",
    async () => {
      const { card } = await hardware(),
        q = await slow("PATCH", `/api/cards/${card.id}`, '{"notes":');
      await call("DELETE", `/api/cards/${card.id}`);
      const r = await q.end('"pending"}');
      assert.equal(r.status, 404);
    },
  );
  await check(
    "kegagalan sinkron feeder membatalkan seluruh pembuatan ODC",
    async () => {
      const { olt, port } = await hardware(),
        name = `ODC rollback ${serial}`;
      sql((db) =>
        db.exec(
          "CREATE TRIGGER audit_fail_feeder BEFORE INSERT ON odc_feeder_ports BEGIN SELECT RAISE(ABORT,'audit injected feeder failure'); END",
        ),
      );
      try {
        assert.equal(
          (
            await request("POST", "/api/odcs", {
              name,
              olt_id: olt.id,
              cable_type: "24_core_4_tube",
              feeder_port_ids: [port.id],
            })
          ).status,
          500,
        );
        assert.equal(
          sql(
            (db) =>
              db
                .prepare("SELECT COUNT(*) AS n FROM odcs WHERE name=?")
                .get(name).n,
          ),
          0,
        );
      } finally {
        sql((db) => db.exec("DROP TRIGGER audit_fail_feeder"));
      }
    },
  );
  await check(
    "kegagalan output splitter bawaan membatalkan ODP, splitter, dan output parsial",
    async () => {
      const { olt } = await hardware(),
        odc = await call("POST", "/api/odcs", {
          name: "Parent transaction",
          olt_id: olt.id,
          cable_type: "24_core_4_tube",
        }),
        name = `ODP rollback ${serial}`;
      const before = sql((db) => ({
        odps: db.prepare("SELECT COUNT(*) AS n FROM odps").get().n,
        splitters: db.prepare("SELECT COUNT(*) AS n FROM splitters").get().n,
        outputs: db.prepare("SELECT COUNT(*) AS n FROM splitter_outputs").get()
          .n,
      }));
      sql((db) =>
        db.exec(
          "CREATE TRIGGER audit_fail_output BEFORE INSERT ON splitter_outputs WHEN NEW.port=3 BEGIN SELECT RAISE(ABORT,'audit injected output failure'); END",
        ),
      );
      try {
        assert.equal(
          (
            await request("POST", "/api/odps", {
              name,
              odc_id: odc.id,
              cable_type: "figure8_6_core",
            })
          ).status,
          500,
        );
        assert.deepEqual(
          sql((db) => ({
            odps: db.prepare("SELECT COUNT(*) AS n FROM odps").get().n,
            splitters: db.prepare("SELECT COUNT(*) AS n FROM splitters").get()
              .n,
            outputs: db
              .prepare("SELECT COUNT(*) AS n FROM splitter_outputs")
              .get().n,
          })),
          before,
        );
      } finally {
        sql((db) => db.exec("DROP TRIGGER audit_fail_output"));
      }
    },
  );
  await check(
    "PATCH ODC gagal harus mempertahankan nama dan daftar feeder sebelumnya",
    async () => {
      const { olt, port } = await hardware(),
        odc = await call("POST", "/api/odcs", {
          name: "Nama ODC awal",
          olt_id: olt.id,
          cable_type: "24_core_4_tube",
          feeder_port_ids: [port.id],
        });
      sql((db) =>
        db.exec(
          `CREATE TRIGGER audit_fail_patch_feeder BEFORE INSERT ON odc_feeder_ports WHEN NEW.odc_id=${odc.id} BEGIN SELECT RAISE(ABORT,'audit injected patch failure'); END`,
        ),
      );
      try {
        assert.equal(
          (
            await request("PATCH", `/api/odcs/${odc.id}`, {
              name: "Tidak boleh tersimpan",
              feeder_port_ids: [port.id],
            })
          ).status,
          500,
        );
        assert.equal(
          sql(
            (db) =>
              db.prepare("SELECT name FROM odcs WHERE id=?").get(odc.id).name,
          ),
          "Nama ODC awal",
        );
        assert.deepEqual(
          sql((db) =>
            db
              .prepare("SELECT port_id FROM odc_feeder_ports WHERE odc_id=?")
              .all(odc.id)
              .map((r) => r.port_id),
          ),
          [port.id],
        );
      } finally {
        sql((db) => db.exec("DROP TRIGGER audit_fail_patch_feeder"));
      }
    },
  );
  await check(
    "logout selama upload membatalkan write yang masih tertunda",
    async () => {
      const a = await actor(),
        q = await slow(
          "POST",
          "/api/olts",
          '{"name":"Tidak boleh sesudah logout","notes":',
          a.token,
        );
      await call("POST", "/api/logout", undefined, 200, a.token);
      assert.equal((await q.end('"pending"}')).status, 401);
    },
  );
  await check(
    "kegagalan port bawaan tidak meninggalkan OLT tanpa inventaris bawaan",
    async () => {
      const name = `OLT fixed gagal ${++serial}`;
      sql((db) =>
        db.exec(
          "CREATE TRIGGER audit_fail_builtin BEFORE INSERT ON olt_cards WHEN NEW.is_builtin=1 BEGIN SELECT RAISE(ABORT,'audit injected builtin failure'); END",
        ),
      );
      try {
        assert.equal(
          (
            await request("POST", "/api/olts", {
              name,
              olt_type: "HSGQ manual",
              interface_mode: "pon",
              fixed_port_count: 8,
            })
          ).status,
          500,
        );
        assert.equal(
          sql(
            (db) =>
              db
                .prepare("SELECT COUNT(*) AS n FROM olts WHERE name=?")
                .get(name).n,
          ),
          0,
        );
      } finally {
        sql((db) => db.exec("DROP TRIGGER audit_fail_builtin"));
      }
    },
  );
  await check(
    "kegagalan ubah kapasitas bawaan membatalkan perubahan metadata OLT",
    async () => {
      const olt = await call("POST", "/api/olts", {
          name: `OLT fixed edit ${++serial}`,
          olt_type: "HSGQ manual",
          interface_mode: "pon",
          fixed_port_count: 8,
        }),
        before = sql((db) =>
          db.prepare("SELECT * FROM olts WHERE id=?").get(olt.id),
        );
      sql((db) =>
        db.exec(
          `CREATE TRIGGER audit_fail_builtin_patch BEFORE UPDATE ON olt_cards WHEN NEW.olt_id=${olt.id} BEGIN SELECT RAISE(ABORT,'audit injected builtin patch failure'); END`,
        ),
      );
      try {
        assert.equal(
          (
            await request("PATCH", `/api/olts/${olt.id}`, {
              location: "Tidak boleh tersimpan",
              fixed_port_count: 16,
            })
          ).status,
          500,
        );
        assert.deepEqual(
          sql((db) => db.prepare("SELECT * FROM olts WHERE id=?").get(olt.id)),
          before,
        );
      } finally {
        sql((db) => db.exec("DROP TRIGGER audit_fail_builtin_patch"));
      }
    },
  );
  await check(
    "kegagalan output membatalkan pembuatan splitter ODC",
    async () => {
      const { olt } = await hardware(),
        d = await call("POST", "/api/odcs", {
          name: `ODC splitter create ${serial}`,
          olt_id: olt.id,
          cable_type: "24_core_4_tube",
        }),
        name = `Splitter gagal ${serial}`;
      sql((db) =>
        db.exec(
          "CREATE TRIGGER audit_fail_splitter_create BEFORE INSERT ON splitter_outputs WHEN NEW.port=2 BEGIN SELECT RAISE(ABORT,'audit injected splitter create failure'); END",
        ),
      );
      try {
        assert.equal(
          (
            await request("POST", "/api/splitters", {
              odc_id: d.id,
              name,
              ratio: "1:4",
              input_core: 1,
            })
          ).status,
          500,
        );
        assert.equal(
          sql(
            (db) =>
              db
                .prepare("SELECT COUNT(*) AS n FROM splitters WHERE name=?")
                .get(name).n,
          ),
          0,
        );
      } finally {
        sql((db) => db.exec("DROP TRIGGER audit_fail_splitter_create"));
      }
    },
  );
  await check(
    "gagal memperbesar splitter tidak meninggalkan rasio berbeda dari jumlah output",
    async () => {
      const { olt } = await hardware(),
        d = await call("POST", "/api/odcs", {
          name: `ODC splitter edit ${serial}`,
          olt_id: olt.id,
          cable_type: "24_core_4_tube",
        }),
        sp = await call("POST", "/api/splitters", {
          odc_id: d.id,
          name: "Splitter rasio awal",
          ratio: "1:2",
          input_core: 1,
        }),
        before = sql((db) =>
          db.prepare("SELECT * FROM splitters WHERE id=?").get(sp.id),
        );
      sql((db) =>
        db.exec(
          `CREATE TRIGGER audit_fail_splitter_patch BEFORE INSERT ON splitter_outputs WHEN NEW.splitter_id=${sp.id} AND NEW.port=3 BEGIN SELECT RAISE(ABORT,'audit injected splitter patch failure'); END`,
        ),
      );
      try {
        assert.equal(
          (
            await request("PATCH", `/api/splitters/${sp.id}`, {
              name: "Tidak boleh tersimpan",
              ratio: "1:4",
            })
          ).status,
          500,
        );
        assert.deepEqual(
          sql((db) =>
            db.prepare("SELECT * FROM splitters WHERE id=?").get(sp.id),
          ),
          before,
        );
        assert.equal(
          sql(
            (db) =>
              db
                .prepare(
                  "SELECT COUNT(*) AS n FROM splitter_outputs WHERE splitter_id=?",
                )
                .get(sp.id).n,
          ),
          2,
        );
      } finally {
        sql((db) => db.exec("DROP TRIGGER audit_fail_splitter_patch"));
      }
    },
  );
  await check(
    "cascade gagal tidak meninggalkan output tersambung dengan input receiver lama",
    async () => {
      const { olt } = await hardware(),
        d = await call("POST", "/api/odcs", {
          name: `ODC cascade failure ${serial}`,
          olt_id: olt.id,
          cable_type: "24_core_4_tube",
        }),
        a = await call("POST", "/api/splitters", {
          odc_id: d.id,
          name: "Root audit",
          ratio: "1:2",
          input_core: 1,
        }),
        b = await call("POST", "/api/splitters", {
          odc_id: d.id,
          name: "Receiver audit",
          ratio: "1:2",
          input_core: 2,
        }),
        out = a.outputs[0],
        before = sql((db) =>
          db.prepare("SELECT * FROM splitter_outputs WHERE id=?").get(out.id),
        );
      sql((db) =>
        db.exec(
          `CREATE TRIGGER audit_fail_cascade BEFORE UPDATE OF input_core ON splitters WHEN NEW.id=${b.id} BEGIN SELECT RAISE(ABORT,'audit injected cascade failure'); END`,
        ),
      );
      try {
        assert.equal(
          (
            await request("PATCH", `/api/splitter-outputs/${out.id}`, {
              target_type: "splitter",
              target_id: b.id,
            })
          ).status,
          500,
        );
        assert.deepEqual(
          sql((db) =>
            db.prepare("SELECT * FROM splitter_outputs WHERE id=?").get(out.id),
          ),
          before,
        );
        assert.equal(
          sql(
            (db) =>
              db
                .prepare("SELECT input_core FROM splitters WHERE id=?")
                .get(b.id).input_core,
          ),
          2,
        );
      } finally {
        sql((db) => db.exec("DROP TRIGGER audit_fail_cascade"));
      }
    },
  );
  await check(
    "hapus receiver gagal mempertahankan referensi cascade yang sebelumnya valid",
    async () => {
      const { olt } = await hardware(),
        d = await call("POST", "/api/odcs", {
          name: `ODC delete failure ${serial}`,
          olt_id: olt.id,
          cable_type: "24_core_4_tube",
        }),
        a = await call("POST", "/api/splitters", {
          odc_id: d.id,
          name: "Root delete audit",
          ratio: "1:2",
          input_core: 1,
        }),
        b = await call("POST", "/api/splitters", {
          odc_id: d.id,
          name: "Receiver delete audit",
          ratio: "1:2",
          input_core: 2,
        }),
        out = a.outputs[0];
      await call("PATCH", `/api/splitter-outputs/${out.id}`, {
        target_type: "splitter",
        target_id: b.id,
      });
      const before = sql((db) =>
        db.prepare("SELECT * FROM splitter_outputs WHERE id=?").get(out.id),
      );
      sql((db) =>
        db.exec(
          `CREATE TRIGGER audit_fail_delete BEFORE DELETE ON splitters WHEN OLD.id=${b.id} BEGIN SELECT RAISE(ABORT,'audit injected delete failure'); END`,
        ),
      );
      try {
        assert.equal(
          (await request("DELETE", `/api/splitters/${b.id}`)).status,
          500,
        );
        assert.deepEqual(
          sql((db) =>
            db.prepare("SELECT * FROM splitter_outputs WHERE id=?").get(out.id),
          ),
          before,
        );
        assert.ok(
          sql((db) =>
            db.prepare("SELECT id FROM splitters WHERE id=?").get(b.id),
          ),
        );
      } finally {
        sql((db) => db.exec("DROP TRIGGER audit_fail_delete"));
      }
    },
  );
  console.log(`\nAUDIT REGRESI API: ${passed} lulus, ${failed} gagal.`);
  if (failed) process.exitCode = 1;
} finally {
  for (const q of pending) q.destroy();
  if (child && child.exitCode == null && child.signalCode == null) {
    const ended = once(child, "exit");
    child.kill();
    await ended;
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
