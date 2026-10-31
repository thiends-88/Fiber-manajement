// Hook React nyata + transport terkendali. Koordinat/akun seluruhnya sintetis.
import assert from "node:assert/strict";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useCableRoutes } from "../src/lib/use-cable-routes.jsx";
import { setMemToken } from "../src/lib/api.js";

const batch = (id) => ({
  id,
  name: `Kumpulan uji ${id}`,
  source_name: `uji-${id}.csv`,
  source_format: "CSV",
  warnings: [],
  route_count: 1,
  vertex_count: 2,
  bounds: [10, -5.01, 10.01, -5],
  created_at: "2026-01-01T00:00:00.000Z",
});
const geometry = (meta) => ({
  version: 1,
  import: meta,
  routes: [
    {
      id: meta.id * 100 + 1,
      import_id: meta.id,
      ordinal: 1,
      name: "Segmen sama",
      description: "Catatan uji",
      folder: "Folder uji",
      color: "#22d3ee",
      coordinates: [
        [10, -5],
        [10.01, -5.01],
      ],
    },
  ],
});
const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
const delay = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function run() {
  const oldFetch = globalThis.fetch,
    oldError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.map(String).join(" "));
  let root,
    host,
    latest,
    passed = 0,
    rows,
    calls,
    holdIndex,
    holdGeometry,
    holdWrite;
  let indexWaiters,
    geometryWaiters,
    writeWaiters,
    invalidGeometry,
    malformedIndex;
  let active, maxActive;
  function Probe() {
    latest = useCableRoutes();
    return (
      <p>
        {latest.loading
          ? "memuat"
          : latest.error || `${latest.visibleRoutes.length} jalur`}
      </p>
    );
  }
  async function wait(check, label) {
    const start = Date.now();
    while (Date.now() - start < 4000) {
      if (check()) return;
      await delay();
    }
    throw Error(`Timeout ${label}: ${host?.textContent}`);
  }
  const count = (route, method = "GET") =>
    calls.filter((r) => r.route === route && r.method === method).length;
  async function releaseAll() {
    holdIndex = holdGeometry = holdWrite = false;
    for (const pending of [
      ...(indexWaiters || []),
      ...(geometryWaiters || []),
      ...(writeWaiters || []),
    ])
      pending.resolve();
    await delay();
  }
  async function mount(ids = [1], strict = false, controls = {}) {
    root?.unmount();
    root = null;
    if (!controls.keepOldPending) await releaseAll();
    host?.remove();
    rows = ids.map(batch);
    calls = [];
    latest = null;
    indexWaiters = [];
    geometryWaiters = [];
    writeWaiters = [];
    invalidGeometry = new Set(controls.invalid || []);
    malformedIndex = false;
    active = maxActive = 0;
    holdIndex = !!controls.index;
    holdGeometry = !!controls.geometry;
    holdWrite = false;
    setMemToken("fixture-cache-header-only");
    globalThis.fetch = async (url, options = {}) => {
      const route = String(url),
        method = options.method || "GET";
      calls.push({ route, method });
      if (route === "/api/route-imports" && method === "GET") {
        const snapshot = structuredClone(rows);
        const pending = deferred();
        pending.rows = snapshot;
        indexWaiters.push(pending);
        if (holdIndex) await pending.promise;
        return response(
          malformedIndex
            ? { version: 99, imports: snapshot }
            : { version: 1, imports: pending.rows },
        );
      }
      if (/^\/api\/route-imports\/\d+$/.test(route) && method === "GET") {
        const id = Number(route.split("/").at(-1)),
          meta = rows.find((r) => r.id === id);
        const pending = deferred();
        pending.id = id;
        geometryWaiters.push(pending);
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          if (holdGeometry) await pending.promise;
          if (!meta) return response({ error: "Tidak ada fixture" }, 404);
          const data = geometry(meta);
          if (invalidGeometry.has(id)) data.routes[0].coordinates[1][0] = 181;
          return response(data);
        } finally {
          active--;
        }
      }
      if (method === "POST" || method === "DELETE") {
        const pending = deferred();
        writeWaiters.push(pending);
        if (holdWrite) await pending.promise;
        if (method === "POST") {
          const created = batch(Math.max(0, ...rows.map((r) => r.id)) + 1);
          rows.push(created);
          return response(created, 201);
        }
        rows = rows.filter((r) => r.id !== Number(route.split("/").at(-1)));
        return response({ ok: true });
      }
      throw Error(`Unexpected ${method} ${route}`);
    };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    root.render(
      strict ? (
        <StrictMode>
          <Probe />
        </StrictMode>
      ) : (
        <Probe />
      ),
    );
    await wait(() => latest !== null, "hook render");
  }
  async function check(name, fn) {
    await fn();
    passed++;
    console.log("OK   ", name);
  }
  try {
    await check(
      "maksimal tiga permintaan geometri bersamaan, seluruh kumpulan akhirnya dimuat",
      async () => {
        await mount([1, 2, 3, 4, 5], false, { geometry: true });
        await wait(() => geometryWaiters.length === 3, "tiga geometri");
        await delay(30);
        assert.equal(geometryWaiters.length, 3);
        assert.equal(maxActive, 3);
        await releaseAll();
        await wait(() => latest.visibleRoutes.length === 5, "lima jalur");
        assert.ok(maxActive <= 3);
        for (const id of [1, 2, 3, 4, 5])
          assert.equal(count(`/api/route-imports/${id}`), 1);
      },
    );
    await check(
      "layer tersembunyi tidak diambil untuk peta/ekspor terfilter; ekspor lengkap tetap memuatnya",
      async () => {
        await mount([1, 2], false, { index: true });
        latest.toggle(2);
        await wait(() => latest.hidden.has(2), "hide");
        await releaseAll();
        await wait(() => latest.visibleRoutes.length === 1, "satu terlihat");
        const previous = count("/api/route-imports/2");
        assert.equal(previous, 0);
        const filtered = await latest.ensureExport(true);
        assert.equal(filtered.length, 1);
        assert.equal(count("/api/route-imports/2"), previous);
        assert.equal((await latest.ensureExport(false)).length, 2);
        assert.equal(count("/api/route-imports/2"), Math.max(previous, 1));
      },
    );
    await check(
      "hide/show/reload memakai cache immutable tanpa mengambil ulang seluruh koordinat",
      async () => {
        await mount([1, 2]);
        await wait(() => latest.visibleRoutes.length === 2, "cache siap");
        latest.toggle(2);
        await wait(() => latest.visibleRoutes.length === 1, "hide");
        latest.toggle(2);
        await wait(() => latest.visibleRoutes.length === 2, "show");
        await latest.reload();
        await wait(() => latest.visibleRoutes.length === 2, "reload cache");
        assert.equal(count("/api/route-imports/1"), 1);
        assert.equal(count("/api/route-imports/2"), 1);
      },
    );
    await check(
      "batch terhapus keluar dari cache/tampilan/ekspor, kumpulan lain tetap utuh",
      async () => {
        await mount([1, 2]);
        await wait(() => latest.visibleRoutes.length === 2, "dua batch");
        await latest.remove(1);
        await wait(() => latest.visibleRoutes.length === 1, "batch dihapus");
        assert.equal(latest.visibleRoutes[0].import_id, 2);
        assert.deepEqual(
          (await latest.ensureExport(false)).map((r) => r.import_id),
          [2],
        );
        assert.equal(count("/api/route-imports/2"), 1);
      },
    );
    await check(
      "respons metadata lama tidak mengganti reload lebih baru",
      async () => {
        await mount([1], false, { index: true });
        const old = latest.reload();
        await wait(() => indexWaiters.length >= 2, "index lama");
        rows = [batch(2)];
        const fresh = latest.reload();
        await wait(() => indexWaiters.length >= 3, "index baru");
        indexWaiters.at(-1).resolve();
        await fresh;
        await wait(() => latest.imports?.[0]?.id === 2, "metadata baru");
        indexWaiters.at(-2).resolve();
        await old;
        await delay(20);
        assert.equal(latest.imports[0].id, 2);
        await releaseAll();
      },
    );
    await check(
      "geometri generasi lama tidak mengotori cache atau menampilkan error setelah reload",
      async () => {
        await mount([1], false, { geometry: true });
        await wait(
          () => geometryWaiters.some((g) => g.id === 1),
          "geometri lama",
        );
        rows = [batch(2)];
        await latest.reload();
        await wait(
          () => geometryWaiters.some((g) => g.id === 2),
          "geometri baru",
        );
        geometryWaiters.find((g) => g.id === 2).resolve();
        await wait(() => latest.visibleRoutes.length === 1, "jalur baru");
        geometryWaiters.find((g) => g.id === 1).resolve();
        await delay(20);
        assert.deepEqual(
          latest.visibleRoutes.map((r) => r.import_id),
          [2],
        );
        assert.deepEqual(latest.geometryErrors, {});
        await releaseAll();
      },
    );
    await check(
      "perubahan sesi membuang geometri pending tanpa mengembalikan hasil ekspor",
      async () => {
        await mount([1], false, { geometry: true });
        await wait(() => geometryWaiters.length === 1, "geometri pending");
        const exported = latest.ensureExport(false);
        const rejected = assert.rejects(
          exported,
          (e) => e.name === "AbortError",
        );
        setMemToken("sesi-baru-fixture");
        await releaseAll();
        await rejected;
        await delay(20);
        assert.equal(latest.visibleRoutes.length, 0);
        assert.deepEqual(latest.geometryErrors, {});
      },
    );
    await check(
      "unmount tidak menerapkan hasil lama ke hook yang dibuka kembali",
      async () => {
        await mount([1], false, { geometry: true });
        await wait(
          () => geometryWaiters.length === 1,
          "pending sebelum unmount",
        );
        root.unmount();
        root = null;
        const late = geometryWaiters[0];
        await mount([2], false, { keepOldPending: true });
        late.resolve();
        await wait(() => latest.visibleRoutes.length === 1, "mount baru");
        assert.deepEqual(
          latest.visibleRoutes.map((r) => r.import_id),
          [2],
        );
      },
    );
    await check(
      "geometri invalid tidak retry tanpa batas dan tidak menghasilkan ekspor parsial",
      async () => {
        await mount([1, 2], false, { invalid: [2] });
        await wait(() => latest.geometryErrors[2], "geometri ditolak");
        const before = count("/api/route-imports/2");
        await delay(60);
        assert.equal(count("/api/route-imports/2"), before);
        await assert.rejects(latest.ensureExport(false), /koordinat/);
        assert.equal(count("/api/route-imports/2"), before + 1);
        invalidGeometry.clear();
        await latest.reload();
        await wait(() => latest.visibleRoutes.length === 2, "retry valid");
      },
    );
    await check(
      "metadata invalid bukan peta kosong sukses, ekspor tetap ditolak",
      async () => {
        await mount();
        malformedIndex = true;
        await latest.reload();
        await wait(() => !!latest.error, "index invalid");
        assert.equal(latest.imports, null);
        await assert.rejects(latest.ensureExport(false), /belum siap/);
      },
    );
    await check(
      "mutasi diserialkan, submit/hapus ganda tidak mengirim request kedua",
      async () => {
        await mount([1]);
        await wait(() => latest.visibleRoutes.length === 1, "siap mutasi");
        holdWrite = true;
        const creating = latest.create({});
        await wait(() => latest.mutating, "mutasi pending");
        await assert.rejects(latest.create({}), /berlangsung/);
        await assert.rejects(latest.remove(1), /berlangsung/);
        assert.equal(count("/api/route-imports", "POST"), 1);
        assert.equal(count("/api/route-imports/1", "DELETE"), 0);
        await releaseAll();
        await creating;
        await wait(() => latest.visibleRoutes.length === 2, "mutasi selesai");
        assert.equal(latest.mutating, false);
      },
    );
    await check(
      "sesi berganti saat save pending tidak reload atau mengembalikan metadata ke sesi baru",
      async () => {
        await mount([1]);
        await wait(() => latest.visibleRoutes.length === 1, "siap save");
        holdWrite = true;
        const before = count("/api/route-imports");
        const rejected = assert.rejects(
          latest.create({}),
          (e) => e.name === "AbortError",
        );
        setMemToken("sesi-sesudah-save-fixture");
        await releaseAll();
        await rejected;
        assert.equal(count("/api/route-imports"), before);
        assert.equal(latest.imports.length, 1);
      },
    );
    await check(
      "StrictMode tidak menggandakan geometri atau menampilkan exception React",
      async () => {
        await mount([1, 2], true);
        await wait(() => latest.visibleRoutes.length === 2, "StrictMode siap");
        assert.equal(count("/api/route-imports/1"), 1);
        assert.equal(count("/api/route-imports/2"), 1);
        assert.deepEqual(errors, []);
      },
    );
    console.log(`\nJALUR CACHE/RACE: ${passed} pemeriksaan lulus.`);
  } finally {
    root?.unmount();
    await releaseAll();
    host?.remove();
    globalThis.fetch = oldFetch;
    console.error = oldError;
    setMemToken(null);
  }
}
