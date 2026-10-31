import assert from "node:assert/strict";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "../src/lib/auth.jsx";
import Peta from "../src/pages/Peta.jsx";
import { mapFixture } from "./map-fixture.mjs";

function FakeCanvas(props) {
  return (
    <section
      data-canvas-points={props.points.length}
      data-canvas-lines={props.showConnections ? props.lines.length : 0}
      data-fit={props.fitRevision}
      data-basemap={String(props.basemap)}
    >
      {props.points.map((node) => (
        <button
          key={node.key}
          data-marker={node.key}
          onClick={() => props.onSelect(node.key)}
        >
          {node.name}
        </button>
      ))}
    </section>
  );
}
function Page() {
  const { user, status } = useAuth();
  return status === "ready" && user ? (
    <Peta MapCanvasComponent={FakeCanvas} />
  ) : (
    <p>Memeriksa sesi</p>
  );
}
export async function run() {
  let root,
    host,
    fixture,
    role,
    mapError,
    malformed,
    holdPatch,
    rejectPatch,
    release,
    calls;
  const errors = [],
    originalError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  let passed = 0;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const text = () => host?.textContent || "";
  async function wait(check, message) {
    const started = Date.now();
    while (Date.now() - started < 4000) {
      if (check()) return;
      await delay(10);
    }
    throw Error(`${message}; ${text().slice(-1300)}`);
  }
  const button = (name) =>
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === name,
    );
  const dialog = () => host.querySelector('[role="dialog"]');
  const input = (label, context = host) => {
    const el = [...context.querySelectorAll("label")].find(
      (l) => l.textContent.trim() === label,
    );
    return el && context.querySelector(`[id="${el.htmlFor}"]`);
  };
  function click(el) {
    assert.ok(el);
    el.click();
  }
  async function fill(el, value) {
    assert.ok(el);
    const proto =
      el.tagName === "SELECT"
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(
      new window.Event(el.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
    await delay(10);
  }
  async function check(name, fn) {
    await fn();
    passed++;
    console.log("OK   ", name);
  }
  function submit() {
    dialog()
      .querySelector("form")
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
  }
  const response = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    });
  const transport = async (url, options = {}) => {
    const route = String(url),
      method = options.method || "GET";
    calls.push({
      route,
      method,
      body: options.body ? JSON.parse(options.body) : null,
    });
    if (route === "/api/me")
      return response({
        user: {
          id: 1,
          email: "fixture@test.local",
          full_name: "Fixture",
          role,
        },
      });
    if (route === "/api/map-data")
      return mapError
        ? response({ error: "Snapshot fixture gagal" }, 503)
        : response(malformed ? { ...fixture, ports: null } : fixture);
    if (method === "PATCH" && /^\/api\/(olts|odcs|odps)\/\d+$/.test(route)) {
      if (holdPatch)
        await new Promise((resolve) => {
          release = resolve;
        });
      if (rejectPatch)
        return response({ error: "Simpan GPS fixture gagal" }, 500);
      const [, table, id] = route.match(/^\/api\/(\w+)\/(\d+)$/),
        body = JSON.parse(options.body);
      const record = fixture[table].find((r) => r.id === Number(id));
      Object.assign(record, {
        coordinate_mode: body.coordinate_mode,
        latitude: body.latitude === "" ? null : Number(body.latitude),
        longitude: body.longitude === "" ? null : Number(body.longitude),
      });
      return response(record);
    }
    throw Error(`Unexpected request ${method} ${route}`);
  };
  async function mount(nextRole = "admin", options = {}) {
    root?.unmount();
    host?.remove();
    fixture = mapFixture();
    role = nextRole;
    mapError = !!options.mapError;
    malformed = !!options.malformed;
    holdPatch = false;
    rejectPatch = false;
    release = null;
    calls = [];
    localStorage.setItem("fiberops_arena_token", "fixture-header-only");
    localStorage.setItem(
      "fiberops_arena_user",
      JSON.stringify({ id: 1, role: "admin" }),
    );
    globalThis.fetch = transport;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    root.render(
      <MemoryRouter>
        <AuthProvider>
          <Page />
        </AuthProvider>
      </MemoryRouter>,
    );
    await wait(
      () =>
        host.querySelector("h1") && !text().includes("Memuat snapshot titik"),
      "Peta belum selesai dimuat",
    );
  }
  try {
    await mount();
    await check(
      "satu GET snapshot, tiga jenis tampil dan koordinat sama tetap tiga marker",
      () => {
        assert.equal(
          calls.filter((c) => c.route === "/api/map-data").length,
          1,
        );
        assert.equal(
          host.querySelector("[data-canvas-points]").dataset.canvasPoints,
          "9",
        );
        for (const key of ["olt-1", "odc-1", "odp-1"])
          assert.ok(host.querySelector(`[data-marker="${key}"]`));
        assert.ok(text().includes("Belum ada koordinat (4)"));
      },
    );
    await check(
      "peta dasar default mati; mengaktifkan hanya mengubah opt-in kanvas",
      async () => {
        assert.equal(
          host.querySelector("[data-basemap]").dataset.basemap,
          "false",
        );
        click([...host.querySelectorAll('input[type="checkbox"]')][1]);
        await wait(
          () => host.querySelector("[data-basemap]").dataset.basemap === "true",
          "Opt-in basemap tidak diterapkan",
        );
      },
    );
    await check(
      "filter jenis mengubah titik/garis, bukan jumlah ekspor lengkap",
      async () => {
        await fill(input("Jenis perangkat"), "odp");
        assert.equal(
          host.querySelector("[data-canvas-points]").dataset.canvasPoints,
          "3",
        );
        assert.equal(
          host.querySelector("[data-canvas-lines]").dataset.canvasLines,
          "1",
        );
        assert.ok(button("Unduh KMZ Lengkap (9 titik)"));
        assert.ok(!button("Unduh KMZ Terfilter (3 titik)").disabled);
      },
    );
    await check(
      "Tampilkan Semua Titik mereset seluruh filter dan memicu fit ulang",
      async () => {
        const before = Number(host.querySelector("[data-fit]").dataset.fit);
        await fill(
          host.querySelector('[aria-label="Cari nama, lokasi, atau induk…"]'),
          "tidak-ada",
        );
        assert.equal(
          host.querySelector("[data-canvas-points]").dataset.canvasPoints,
          "0",
        );
        click(button("Tampilkan Semua Titik"));
        await wait(
          () =>
            host.querySelector("[data-canvas-points]").dataset.canvasPoints ===
            "9",
          "Reset semua titik gagal",
        );
        assert.equal(input("Jenis perangkat").value, "");
        assert.equal(
          host.querySelector('[aria-label="Cari nama, lokasi, atau induk…"]')
            .value,
          "",
        );
        assert.equal(
          Number(host.querySelector("[data-fit]").dataset.fit),
          before + 1,
        );
      },
    );
    await check(
      "filter induk berlabel inventaris dan koneksi lintas filter diberi keterangan",
      async () => {
        await fill(input("OLT induk inventaris"), "2");
        assert.equal(
          host.querySelector("[data-canvas-points]").dataset.canvasPoints,
          "2",
        );
        assert.ok(text().includes("koneksi melewati batas filter"));
        assert.ok(text().includes("bukan bukti sumber fisik OLT"));
        click(button("Tampilkan Semua Titik"));
        await wait(
          () =>
            host.querySelector("[data-canvas-points]").dataset.canvasPoints ===
            "9",
          "Reset filter gagal",
        );
      },
    );
    await check(
      "toggle skematis berlaku pada peta dan label ekspor, bukan rute GPS",
      async () => {
        click([...host.querySelectorAll('input[type="checkbox"]')][0]);
        await wait(
          () =>
            host.querySelector("[data-canvas-lines]").dataset.canvasLines ===
            "0",
          "Toggle garis gagal",
        );
        assert.ok(text().includes("bukan rute kabel fisik/GPS"));
        click([...host.querySelectorAll('input[type="checkbox"]')][0]);
      },
    );
    await check(
      "detail marker memakai ID, nama/alamat berisi markup tetap teks",
      async () => {
        click(host.querySelector('[data-marker="odp-2"]'));
        await wait(
          () => host.querySelector('[data-selected-device="odp-2"]'),
          "Detail marker belum tampil",
        );
        assert.equal(host.querySelectorAll("script,img[src=x]").length, 0);
        assert.ok(
          host
            .querySelector('[data-selected-device="odp-2"]')
            .textContent.includes(fixture.odps[1].name),
        );
        assert.ok(host.querySelector('a[href="/odp?odp=2"]'));
      },
    );
    await check(
      "pembukaan GPS manual memuat nilai tersimpan; menutup tanpa save tidak menulis",
      async () => {
        click(
          host.querySelector(
            '[data-selected-device="odp-2"] button:last-of-type',
          ),
        );
        await wait(dialog, "GPS dialog belum muncul");
        assert.equal(input("Sumber koordinat peta", dialog()).value, "manual");
        assert.equal(input("Latitude (lintang)", dialog()).value, "-0.83");
        click(dialog().querySelector('[aria-label="Tutup"]'));
        await wait(() => !dialog(), "Dialog belum ditutup");
        assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
      },
    );
    await check(
      "mode none tidak menghapus alamat, save hanya mengirim tiga field GPS",
      async () => {
        click(host.querySelector('[data-marker="odp-1"]'));
        await wait(
          () => host.querySelector('[data-selected-device="odp-1"]'),
          "Detail ODP belum muncul",
        );
        click(
          host.querySelector(
            '[data-selected-device="odp-1"] button:last-of-type',
          ),
        );
        await wait(dialog, "Dialog ODP belum tampil");
        await fill(input("Sumber koordinat peta", dialog()), "none");
        submit();
        await wait(
          () =>
            !dialog() &&
            host.querySelector("[data-canvas-points]")?.dataset.canvasPoints ===
              "8",
          "Clear GPS belum terpantul ke peta",
        );
        const sent = calls.find((c) => c.method === "PATCH");
        assert.deepEqual(Object.keys(sent.body).sort(), [
          "coordinate_mode",
          "latitude",
          "longitude",
        ]);
        assert.equal(fixture.odps[0].location, "( -0.79, 100.64 )");
        assert.equal(fixture.odps[0].coordinate_mode, "none");
      },
    );
    await check(
      "simpan pending mengunci field/X/Escape/backdrop dan menolak submit ganda",
      async () => {
        click(host.querySelector('[data-marker="olt-1"]'));
        await wait(
          () => host.querySelector('[data-selected-device="olt-1"]'),
          "Detail OLT belum tampil",
        );
        click(
          host.querySelector(
            '[data-selected-device="olt-1"] button:last-of-type',
          ),
        );
        await wait(dialog, "Dialog GPS OLT belum tampil");
        await fill(input("Latitude (lintang)", dialog()), "-0.88");
        holdPatch = true;
        const before = calls.filter((c) => c.method === "PATCH").length;
        submit();
        await wait(() => release, "Request belum pending");
        submit();
        await delay(20);
        assert.equal(
          calls.filter((c) => c.method === "PATCH").length,
          before + 1,
        );
        assert.equal(dialog().getAttribute("aria-busy"), "true");
        assert.ok(
          [...dialog().querySelectorAll("input,select,textarea,button")].every(
            (el) => el.matches(":disabled"),
          ),
        );
        document.dispatchEvent(
          new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        host
          .querySelector(".modal-overlay")
          .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
        assert.ok(dialog());
        release();
        await wait(
          () => !dialog() && text().includes("GPS tersimpan"),
          "GPS sukses belum menutup dialog",
        );
        assert.equal(fixture.olts[0].latitude, -0.88);
      },
    );
    await check(
      "save gagal mempertahankan nilai/form, membuka kunci dan dapat dicoba ulang",
      async () => {
        click(
          host.querySelector(
            '[data-selected-device="olt-1"] button:last-of-type',
          ),
        );
        await wait(dialog, "Dialog belum tampil");
        await fill(input("Latitude (lintang)", dialog()), "-0.89");
        holdPatch = false;
        rejectPatch = true;
        submit();
        await wait(
          () => text().includes("Simpan GPS fixture gagal"),
          "Error belum tampil",
        );
        assert.ok(dialog());
        assert.equal(input("Latitude (lintang)", dialog()).value, "-0.89");
        assert.ok(!dialog().querySelector('[aria-label="Tutup"]').disabled);
        assert.equal(dialog().getAttribute("aria-busy"), "false");
        rejectPatch = false;
        submit();
        await wait(() => !dialog(), "Retry save belum berhasil");
        assert.equal(fixture.olts[0].latitude, -0.89);
      },
    );
    await check(
      "reload gagal membuang snapshot lama dan menutup ekspor data stale",
      async () => {
        mapError = true;
        click(button("Muat ulang peta"));
        await wait(
          () => text().includes("Snapshot fixture gagal"),
          "Error reload belum tampil",
        );
        assert.equal(host.querySelectorAll("[data-canvas-points]").length, 0);
        assert.ok(
          ![...host.querySelectorAll("button")].some((b) =>
            b.textContent.includes("Unduh KMZ"),
          ),
        );
        mapError = false;
        click(button("Coba lagi"));
        await wait(
          () => host.querySelector("[data-canvas-points]"),
          "Retry load gagal",
        );
      },
    );
    await check(
      "snapshot tidak lengkap tidak dianggap peta kosong/ekspor lengkap",
      async () => {
        malformed = true;
        click(button("Muat ulang peta"));
        await wait(
          () => text().includes("Snapshot peta belum lengkap/valid"),
          "Validasi snapshot tidak bekerja",
        );
        assert.ok(!host.querySelector("[data-canvas-points]"));
        assert.ok(button("Tampilkan Semua Titik").disabled);
      },
    );
    await check(
      "profil pembaca dari /me mengalahkan cache admin dan tidak menampilkan tombol tulis",
      async () => {
        await mount("user");
        assert.ok(
          ![...host.querySelectorAll("button")].some((b) =>
            /GPS|Atur koordinat/.test(b.textContent),
          ),
        );
        assert.ok(!button("Unduh KMZ Lengkap (9 titik)").disabled);
        assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
      },
    );
    await check(
      "tidak ada error React, exception render, atau token URL pada permintaan UI",
      () => {
        assert.deepEqual(errors, []);
        assert.ok(calls.every((c) => !/[?&]token=/.test(c.route)));
      },
    );
    console.log(`\nPETA UI: ${passed} pemeriksaan lulus.`);
  } finally {
    release?.();
    root?.unmount();
    host?.remove();
    console.error = originalError;
  }
}
