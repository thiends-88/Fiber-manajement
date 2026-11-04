import assert from "node:assert/strict";
import { startRouteImport } from "../src/lib/route-import-client.js";
import { buildKmzArchive } from "../src/lib/kmz-export-client.js";
import { ROUTE_LIMITS } from "../src/lib/cable-routes.js";
let passed = 0,
  mode = "ok",
  instances = [];
class FakeWorker {
  constructor(url, options) {
    this.url = String(url);
    this.options = options;
    this.terminated = false;
    instances.push(this);
  }
  terminate() {
    this.terminated = true;
  }
  postMessage(data, transfer) {
    this.payload = data;
    this.transfer = transfer;
    queueMicrotask(() => {
      if (this.terminated || mode === "hold") return;
      if (mode === "malformed") this.onmessage?.({ data: null });
      else if (mode === "error") this.onerror?.(new Error("fixture"));
      else if (mode === "reject")
        this.onmessage?.({
          data: { ok: false, error: "Fixture parser/ZIP ditolak" },
        });
      else
        this.onmessage?.({
          data: {
            ok: true,
            result: { route_count: 1 },
            buffer: new Uint8Array([80, 75, 3, 4]).buffer,
          },
        });
    });
  }
}
const oldWorker = globalThis.Worker;
const file = (size = 10) => ({
  size,
  name: "uji.csv",
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
});
async function check(name, fn) {
  await fn();
  passed++;
  console.log("OK   ", name);
}
try {
  globalThis.Worker = FakeWorker;
  await check(
    "worker impor hanya dibuat setelah berkas valid dipilih, module lokal dan buffer ditransfer",
    async () => {
      instances = [];
      const task = startRouteImport(file());
      const result = await task.promise;
      assert.equal(result.route_count, 1);
      assert.match(instances[0].url, /route-import\.worker\.js/);
      assert.equal(instances[0].options.type, "module");
      assert.equal(instances[0].transfer.length, 1);
      assert.ok(instances[0].terminated);
    },
  );
  await check(
    "berkas kosong/lebih 3MB tidak pernah membuat worker",
    async () => {
      instances = [];
      for (const size of [0, ROUTE_LIMITS.fileBytes + 1])
        await assert.rejects(startRouteImport(file(size)).promise, /3 MB/);
      assert.equal(instances.length, 0);
    },
  );
  await check(
    "cancel menghentikan worker dan menolak hasil terlambat",
    async () => {
      mode = "hold";
      const task = startRouteImport(file());
      await Promise.resolve();
      task.cancel();
      await assert.rejects(task.promise, (e) => e.name === "AbortError");
      assert.ok(instances.at(-1).terminated);
    },
  );
  await check(
    "hasil invalid dari parser dan kegagalan skrip dilaporkan tanpa worker bocor",
    async () => {
      for (const next of ["reject", "error"]) {
        mode = next;
        await assert.rejects(startRouteImport(file()).promise);
        assert.ok(instances.at(-1).terminated);
      }
    },
  );
  await check(
    "browser tanpa worker memberi error jelas, tidak memindahkan parsing berat ke main thread",
    async () => {
      globalThis.Worker = undefined;
      await assert.rejects(
        startRouteImport(file()).promise,
        /Browser belum mendukung/,
      );
      globalThis.Worker = FakeWorker;
    },
  );
  const view = {
      points: [],
      missing: [],
      get lines() {
        throw Error("Jangan baca koneksi logis");
      },
      get hiddenConnections() {
        throw Error("Jangan baca jumlah koneksi");
      },
    },
    icons = () => ({
      olt: new Uint8Array([1]),
      odc: new Uint8Array([2]),
      odp: new Uint8Array([3]),
    });
  await check(
    "KMZ worker hanya menerima titik/missing, tanpa grafik koneksi; ikon lokal ditransfer",
    async () => {
      mode = "ok";
      const bytes = await buildKmzArchive(view, { scope: "lengkap" }, icons());
      assert.deepEqual([...bytes], [80, 75, 3, 4]);
      assert.match(instances.at(-1).url, /kmz-export\.worker\.js/);
      assert.equal(instances.at(-1).transfer.length, 3);
      assert.deepEqual(Object.keys(instances.at(-1).payload.view).sort(), [
        "missing",
        "points",
      ]);
      assert.ok(instances.at(-1).terminated);
    },
  );
  await check("abort sebelum ekspor tidak membuat worker", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const count = instances.length;
    await assert.rejects(
      buildKmzArchive(view, {}, icons(), ctl.signal),
      (e) => e.name === "AbortError",
    );
    assert.equal(instances.length, count);
  });
  await check(
    "logout/navigasi selama ekspor membatalkan worker dan tidak mengembalikan arsip",
    async () => {
      mode = "hold";
      const ctl = new AbortController();
      const task = buildKmzArchive(view, {}, icons(), ctl.signal);
      ctl.abort();
      await assert.rejects(task, (e) => e.name === "AbortError");
      assert.ok(instances.at(-1).terminated);
    },
  );
  await check("kegagalan ZIP/worker tidak dianggap ekspor sukses", async () => {
    for (const next of ["reject", "error"]) {
      mode = next;
      await assert.rejects(buildKmzArchive(view, {}, icons()));
      assert.ok(instances.at(-1).terminated);
    }
  });
  await check("timeout mengakhiri worker impor dan ZIP", async () => {
    mode = "hold";
    const original = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) =>
      original(fn, ms === 30000 ? 1 : ms, ...args);
    try {
      await assert.rejects(startRouteImport(file()).promise, /lama/);
      assert.ok(instances.at(-1).terminated);
      await assert.rejects(buildKmzArchive(view, {}, icons()), /lama/);
      assert.ok(instances.at(-1).terminated);
    } finally {
      globalThis.setTimeout = original;
    }
  });
  await check(
    "berkas selesai dibaca setelah cancel/timeout tidak dikirim ke worker yang sudah dihentikan",
    async () => {
      mode = "hold";
      for (const timeout of [false, true]) {
        let release;
        const pendingFile = {
          size: 10,
          name: "lambat.csv",
          arrayBuffer: () => new Promise((done) => (release = done)),
        };
        const original = globalThis.setTimeout;
        if (timeout)
          globalThis.setTimeout = (fn, ms, ...args) =>
            original(fn, ms === 30000 ? 1 : ms, ...args);
        try {
          const task = startRouteImport(pendingFile),
            worker = instances.at(-1);
          if (!timeout) task.cancel();
          await assert.rejects(task.promise);
          release(new ArrayBuffer(4));
          await Promise.resolve();
          assert.equal(worker.payload, undefined);
          assert.ok(worker.terminated);
        } finally {
          globalThis.setTimeout = original;
        }
      }
    },
  );
  await check(
    "pesan worker rusak gagal tertutup, bukan promise menggantung atau KMZ kosong",
    async () => {
      mode = "malformed";
      await assert.rejects(startRouteImport(file()).promise, /Gagal membaca/);
      assert.ok(instances.at(-1).terminated);
      await assert.rejects(buildKmzArchive(view, {}, icons()), /Arsip KMZ/);
      assert.ok(instances.at(-1).terminated);
    },
  );
  console.log(`\nJALUR WORKER/CANCEL: ${passed} pemeriksaan lulus.`);
} finally {
  globalThis.Worker = oldWorker;
}
