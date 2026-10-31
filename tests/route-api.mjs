// API produksi nyata dengan SQLite sementara, tidak mengakses data pengguna.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
const ROOT = path.resolve(import.meta.dirname, ".."),
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-route-api-")),
  DB = path.join(TMP, "fixture.db");
const PORT = Number(process.env.UJI_ROUTE_API_PORT || 4812),
  BASE = `http://127.0.0.1:${PORT}`;
const email = "owner-routes@test.local",
  password = "PrivateRoutesOwner123!";
let app,
  token,
  passed = 0;
const pending = new Set();
const body = () => ({
  name: "Kumpulan uji",
  source_name: "uji.csv",
  source_format: "CSV",
  warnings: [],
  routes: [
    {
      name: "Nama sama",
      description: "catatan fixture",
      folder: "",
      color: "#22d3ee",
      coordinates: [
        [10, -5],
        [10.01, -5.01],
        [10.02, -5.015],
      ],
    },
    {
      name: "Nama sama",
      description: "cabang fixture",
      folder: "",
      color: "#34d399",
      coordinates: [
        [10.02, -5.015],
        [10.03, -5.02],
      ],
    },
  ],
});
function sql(fn) {
  const db = new DatabaseSync(DB);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
const snapshot = () =>
  sql((db) =>
    Object.fromEntries(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'map_route_%' ORDER BY name",
        )
        .all()
        .map(({ name }) => [
          name,
          db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all(),
        ]),
    ),
  );
async function start() {
  let log = "";
  app = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      ARENA_DB_PATH: DB,
      ARENA_API_PORT: String(PORT),
      ARENA_API_HOST: "127.0.0.1",
      ARENA_PUBLIC_ORIGIN: BASE,
      ARENA_SECURE_COOKIES: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(log)), 12000);
    const append = (d) => {
      log += d;
      if (log.includes("siap di")) {
        clearTimeout(timer);
        resolve();
      }
    };
    app.stdout.on("data", append);
    app.stderr.on("data", append);
    app.once("error", reject);
    app.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`Server ${code}: ${log}`));
    });
  });
}
async function stop() {
  if (app && app.exitCode == null && app.signalCode == null) {
    const ended = once(app, "exit");
    app.kill();
    await ended;
  }
  app = null;
}
async function request(
  method,
  route,
  data,
  status = method === "POST" ? 201 : 200,
  auth = token,
  extra = {},
) {
  const response = await fetch(BASE + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...extra,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${route}: ${text}`);
  return { data: JSON.parse(text), response };
}
async function check(name, fn) {
  await fn();
  passed++;
  console.log("OK   ", name);
}
// Gunakan builder sederhana untuk memastikan potongan body tepat.
async function slowBody(auth) {
  const raw = JSON.stringify(body());
  const cut = raw.indexOf(",");
  let done, fail;
  const result = new Promise((r, j) => {
    done = r;
    fail = j;
  });
  const req = http.request(
    BASE + "/api/route-imports",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth}`,
        "content-type": "application/json",
        "transfer-encoding": "chunked",
        expect: "100-continue",
      },
    },
    (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => {
        pending.delete(req);
        done({ status: res.statusCode, data: JSON.parse(text) });
      });
    },
  );
  pending.add(req);
  req.on("error", fail);
  req.flushHeaders();
  await once(req, "continue");
  await new Promise((r) => req.write(raw.slice(0, cut), r));
  await request("GET", "/healthz", undefined, 200, null);
  return () => {
    req.end(raw.slice(cut));
    return result;
  };
}
try {
  const bootstrap = spawnSync(
    process.execPath,
    ["scripts/create-admin.mjs", email],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        ARENA_DB_PATH: DB,
        FIBEROPS_ADMIN_NAME: "Pemilik fixture jalur",
      },
      input: password,
      encoding: "utf8",
    },
  );
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  await start();
  token = (await request("POST", "/api/login", { email, password }, 200, null))
    .data.token;
  const reader = (
    await request("POST", "/api/users", {
      email: "reader-routes@test.local",
      password: "PrivateReader123!",
      full_name: "Pembaca fixture",
      role: "user",
    })
  ).data;
  const operator = (
    await request("POST", "/api/users", {
      email: "operator-routes@test.local",
      password: "PrivateOperator123!",
      full_name: "Operator fixture",
      role: "operator",
    })
  ).data;
  const readerToken = (
    await request(
      "POST",
      "/api/login",
      { email: reader.email, password: "PrivateReader123!" },
      200,
      null,
    )
  ).data.token;
  const operatorToken = (
    await request(
      "POST",
      "/api/login",
      { email: operator.email, password: "PrivateOperator123!" },
      200,
      null,
    )
  ).data.token;
  const olt = (
    await request("POST", "/api/olts", {
      name: "OLT fixture C320",
      olt_type: "ZTE C320",
      location: "Alamat lama fixture",
      ip: "192.0.2.8",
    })
  ).data;
  const odc = (
    await request("POST", "/api/odcs", {
      name: "ODC fixture",
      olt_id: olt.id,
      cable_type: "48_core_4_tube",
      location: "Alamat ODC",
    })
  ).data;
  await request("POST", "/api/odps", {
    name: "ODP fixture",
    odc_id: odc.id,
    cable_type: "12_core_2_tube",
    location: "Alamat ODP",
  });
  const before = JSON.stringify(snapshot());
  let saved;
  await check(
    "index/geometri memerlukan sesi; token query diabaikan",
    async () => {
      await request("GET", "/api/route-imports", undefined, 401, null);
      await request(
        "GET",
        `/api/route-imports?token=${encodeURIComponent(token)}`,
        undefined,
        401,
        null,
      );
      await request("GET", "/api/route-imports/1", undefined, 401, null);
    },
  );
  await check(
    "index awal kosong, private/no-store dan tidak memuat array koordinat",
    async () => {
      const result = await request("GET", "/api/route-imports");
      assert.deepEqual(result.data, { version: 1, imports: [] });
      assert.match(result.response.headers.get("cache-control"), /no-store/);
      assert.equal(JSON.stringify(snapshot()), before);
    },
  );
  await check("reader dapat index tetapi POST/DELETE ditolak 403", async () => {
    await request("GET", "/api/route-imports", undefined, 200, readerToken);
    await request("POST", "/api/route-imports", body(), 403, readerToken);
    await request(
      "DELETE",
      "/api/route-imports/1",
      undefined,
      403,
      readerToken,
    );
  });
  await check("Origin asing ditolak tanpa menyimpan geometri", async () => {
    await request("POST", "/api/route-imports", body(), 403, token, {
      origin: "https://foreign.invalid",
    });
    assert.equal(
      (await request("GET", "/api/route-imports")).data.imports.length,
      0,
    );
  });
  await check(
    "operator menyimpan jalur; akun/GPS/model/card/feeder/splitter tetap identik",
    async () => {
      saved = (
        await request("POST", "/api/route-imports", body(), 201, operatorToken)
      ).data;
      assert.equal(saved.route_count, 2);
      assert.equal(saved.vertex_count, 5);
      assert.equal(JSON.stringify(snapshot()), before);
    },
  );
  await check(
    "index hanya metadata; geometri terpisah dan ber-ID meskipun nama sama",
    async () => {
      const index = (await request("GET", "/api/route-imports")).data;
      assert.ok(!JSON.stringify(index).includes("coordinates"));
      assert.ok(!JSON.stringify(index).includes("password"));
      const geo = (
        await request(
          "GET",
          `/api/route-imports/${saved.id}`,
          undefined,
          200,
          readerToken,
        )
      ).data;
      assert.equal(geo.routes.length, 2);
      assert.notEqual(geo.routes[0].id, geo.routes[1].id);
      assert.deepEqual(geo.routes[0].coordinates, body().routes[0].coordinates);
    },
  );
  await check(
    "reimport duplikat 409 dan koordinat invalid 400 tidak menambah row",
    async () => {
      await request(
        "POST",
        "/api/route-imports",
        { ...body(), source_name: "rename.csv" },
        409,
      );
      for (const coordinates of [
        [
          [181, 0],
          [10, -5],
        ],
        [
          [10, -91],
          [11, -5],
        ],
        [[10, -5]],
        [
          [10, -5],
          [10, -5],
        ],
        [
          [null, 0],
          [1, 2],
        ],
      ])
        await request(
          "POST",
          "/api/route-imports",
          { ...body(), routes: [{ ...body().routes[0], coordinates }] },
          400,
        );
      assert.equal(
        (await request("GET", "/api/route-imports")).data.imports.length,
        1,
      );
    },
  );
  await check("kegagalan SQL segmen kedua rollback seluruh impor", async () => {
    sql((db) =>
      db.exec(
        "CREATE TRIGGER fail_route_api BEFORE INSERT ON map_route_segments WHEN NEW.ordinal=2 BEGIN SELECT RAISE(ABORT,'fixture'); END",
      ),
    );
    try {
      await request(
        "POST",
        "/api/route-imports",
        {
          ...body(),
          routes: body().routes.map((r) => ({ ...r, name: "gagal " + r.name })),
        },
        500,
      );
      assert.equal(
        (await request("GET", "/api/route-imports")).data.imports.length,
        1,
      );
      assert.equal(JSON.stringify(snapshot()), before);
    } finally {
      sql((db) => db.exec("DROP TRIGGER fail_route_api"));
    }
  });
  await check(
    "restart production mempertahankan semua ID/metadata/vertex dan akun",
    async () => {
      const geo = JSON.stringify(
        (await request("GET", `/api/route-imports/${saved.id}`)).data,
      );
      await stop();
      await start();
      assert.equal(
        JSON.stringify(
          (await request("GET", `/api/route-imports/${saved.id}`)).data,
        ),
        geo,
      );
      assert.equal(JSON.stringify(snapshot()), before);
    },
  );
  await check(
    "snapshot peta/dashboard tidak diam-diam membundel geometri jalur",
    async () => {
      for (const route of ["/api/map-data", "/api/dashboard"]) {
        const raw = JSON.stringify((await request("GET", route)).data);
        assert.ok(!raw.includes("map_route_segments"));
        assert.ok(!raw.includes("source_format"));
      }
    },
  );
  await check(
    "hapus batch hanya menghapus jalur, tidak inventaris/account/mapping",
    async () => {
      await request(
        "DELETE",
        `/api/route-imports/${saved.id}`,
        undefined,
        200,
        operatorToken,
      );
      assert.equal(
        (await request("GET", "/api/route-imports")).data.imports.length,
        0,
      );
      assert.equal(
        sql(
          (db) =>
            db.prepare("SELECT COUNT(*) AS n FROM map_route_segments").get().n,
        ),
        0,
      );
      assert.equal(JSON.stringify(snapshot()), before);
      await request("GET", `/api/route-imports/${saved.id}`, undefined, 404);
    },
  );
  await check(
    "role dicabut selama upload JSON: tidak ada impor yang tersimpan",
    async () => {
      const finish = await slowBody(operatorToken);
      await request("PATCH", `/api/users/${operator.id}`, { role: "user" });
      const result = await finish();
      assert.equal(result.status, 403);
      assert.equal(
        (await request("GET", "/api/route-imports")).data.imports.length,
        0,
      );
      await request("PATCH", `/api/users/${operator.id}`, { role: "operator" });
    },
  );
  await check(
    "logout selama upload JSON menolak write dari sesi yang dicabut",
    async () => {
      const ownToken = (
        await request(
          "POST",
          "/api/login",
          { email: operator.email, password: "PrivateOperator123!" },
          200,
          null,
        )
      ).data.token;
      const finish = await slowBody(ownToken);
      await request("POST", "/api/logout", {}, 200, ownToken);
      assert.equal((await finish()).status, 401);
      assert.equal(
        (await request("GET", "/api/route-imports")).data.imports.length,
        0,
      );
    },
  );
  await check("body besar ditolak 413 sebelum geometri disimpan", async () => {
    await request(
      "POST",
      "/api/route-imports",
      { ...body(), padding: "x".repeat(1000001) },
      413,
    );
    assert.equal(
      (await request("GET", "/api/route-imports")).data.imports.length,
      0,
    );
  });
  console.log(`\nJALUR API PRODUKSI: ${passed} pemeriksaan lulus.`);
} finally {
  for (const req of pending) req.destroy();
  await stop();
  fs.rmSync(TMP, { recursive: true, force: true });
}
