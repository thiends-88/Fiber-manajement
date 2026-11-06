import assert from "node:assert/strict";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import App from "../src/App.jsx";
import { AuthProvider } from "../src/lib/auth.jsx";
import { setMemToken } from "../src/lib/api.js";
import { useDeviceEditorNavigation } from "../src/lib/use-device-editor-navigation.js";

function RouteControls() {
  const location = useLocation(), navigate = useNavigate();
  return <div><output data-test-location>{location.pathname + location.search}</output><button onClick={() => navigate(-1)}>History back</button><button onClick={() => navigate(1)}>History forward</button></div>;
}
function HookHarness({ initial = 1, blocked = false }) {
  const [id, setId] = useState(initial), [version, setVersion] = useState(0);
  const nav = useDeviceEditorNavigation({ selectedId: id, onSelect: setId, blocked });
  return <div><button data-open="2" onClick={() => nav.open(2)}>Two</button><button data-open="3" onClick={() => nav.open(3)}>Three</button><button data-refresh onClick={() => setVersion(v => v + 1)}>Refresh</button><h2 ref={nav.editorRef} data-hook-id={id} tabIndex={-1}>{id}:{version}</h2></div>;
}
export async function run({ frames, scrolls, flushFrames }) {
  const olts = [{ id: 41, name: "OLT-UJI-C300", olt_type: "ZTE C300" }, { id: 43, name: "OLT-UJI-C320", olt_type: "ZTE C320" }];
  const odcs = Array.from({ length: 62 }, (_, i) => ({ id: 1001 + i * 7, name: i === 1 || i === 2 ? "ODC-NAMA-SAMA-UJI" : `ODC-UJI-NAV-${String(i + 1).padStart(3, "0")}`, olt_id: olts[i % 2].id, olt_name: olts[i % 2].name, location: "Alamat uji saja", cable_type: "figure8_6_core", core_count: 0, odp_count: 0 }));
  const odps = Array.from({ length: 70 }, (_, i) => ({ id: 8001 + i * 11, name: i === 1 || i === 2 ? "ODP-NAMA-SAMA-UJI" : `ODP-UJI-NAV-${String(i + 1).padStart(3, "0")}`, odc_id: odcs[i % odcs.length].id, odc_name: odcs[i % odcs.length].name, location: "Tiang uji saja", cable_type: "figure8_6_core", core_count: 0 }));
  const calls = [], errors = [], originalFetch = globalThis.fetch, originalError = console.error;
  let root, host, role = "admin", passed = 0;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input), "http://navigation-ui.test"), method = options.method || "GET";
    calls.push({ method, url: url.pathname + url.search });
    assert.equal(method, "GET", "Navigasi tidak boleh melakukan write API");
    const data = { olts, odcs, odps, ports: [], "feeder-ports": [], splitters: [], cores: [], links: [], "interface-mappings": [] };
    const key = url.pathname.slice(5);
    assert.ok(key === "me" || Object.hasOwn(data, key), `API mock tidak tersedia: ${url.pathname}`);
    return new Response(JSON.stringify(key === "me" ? { user: { id: 7, email: "navigation-ui@synthetic.test", full_name: "Pengguna UJI", role } } : data[key]), { status: 200, headers: { "content-type": "application/json" } });
  };
  const delay = () => new Promise(resolve => setTimeout(resolve, 8));
  async function wait(check, message, flush = true) {
    const end = Date.now() + 5000;
    while (Date.now() < end) { if (flush) flushFrames();if (check()) return;await delay(); }
    throw Error(`${message}; tampilan: ${host?.textContent.slice(-900)}`);
  }
  async function check(name, test) { await test();passed++;console.log(`OK ${name}`); }
  function unmount() { root?.unmount();host?.remove();root = null;host = null; }
  function render(element) { unmount();host = document.createElement("div");document.body.append(host);root = createRoot(host);root.render(element); }
  async function mount(route, { reader = false, entries, strict = false } = {}) {
    role = reader ? "user" : "admin";setMemToken("navigation-ui-synthetic-token");
    const page = <MemoryRouter initialEntries={entries || [route]}><RouteControls /><AuthProvider><App /></AuthProvider></MemoryRouter>;
    render(strict ? <StrictMode>{page}</StrictMode> : page);
    await wait(() => host.querySelector("[data-device-row]"), "Daftar perangkat belum tampil");
  }
  const row = id => host.querySelector(`[data-device-row="${id}"]`);
  const opener = id => row(id)?.querySelector('button[aria-label^="Buka area input"]');
  const heading = () => host.querySelector("[data-device-editor] h2[data-device-id]");
  const editor = () => host.querySelector("[data-device-editor]");
  const buttons = () => [...host.querySelectorAll("button")];
  const button = name => buttons().find(node => node.textContent.trim() === name);
  const location = () => host.querySelector("[data-test-location]").textContent;
  const focused = id => heading()?.dataset.deviceId === String(id) && document.activeElement === heading();
  function fill(input, value) { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);input.dispatchEvent(new window.Event("input", { bubbles: true })); }
  try {
    for (const [kind, records] of [["ODC", odcs], ["ODP", odps]]) {
      const lower = kind.toLowerCase(), first = records[0], last = records.at(-1);
      await check(`${kind}: daftar panjang tidak menggulir atau memilih perangkat sendiri`, async () => {
        const count = scrolls.length;await mount(`/${lower}`);
        assert.equal(host.querySelectorAll("[data-device-row]").length, records.length);assert.ok(!editor());assert.equal(scrolls.length, count);
        assert.equal(opener(first.id).tagName, "BUTTON");assert.equal(opener(first.id).type, "button");
      });
      await check(`${kind}: klik nama langsung memfokuskan area input ID tepat`, async () => {
        opener(first.id).click();await wait(() => focused(first.id), "Judul input tidak mendapat fokus");
        assert.equal(location(), `/${lower}?${lower}=${first.id}`);assert.equal(opener(first.id).getAttribute("aria-current"), "true");
        assert.deepEqual(scrolls.at(-1).options, { behavior: "instant", block: "start", inline: "nearest" });
      });
      await check(`${kind}: Core/interface/splitter dan kembali ke baris tanpa request ulang`, async () => {
        await wait(() => !host.querySelector('[role="status"]'), "Panel belum selesai memuat");
        const count = calls.length;
        for (const name of ["Core", kind === "ODC" ? "Interface feeder" : "Asal interface", "Splitter"]) {
          button(name).click();await wait(() => document.activeElement?.getAttribute("role") === "region" && document.activeElement.getAttribute("aria-label").includes(first.name), "Shortcut tidak berpindah bagian");
        }
        button(`Kembali ke daftar ${kind}`).click();await wait(() => document.activeElement === opener(first.id), "Kembali tidak ke baris terpilih");
        assert.equal(calls.length, count);
      });
      await check(`${kind}: klik ulang tidak menutup panel atau memuat data ulang`, async () => {
        const current = editor(), count = calls.length;opener(first.id).click();await wait(() => focused(first.id), "Klik ulang tidak kembali ke input");
        assert.equal(editor(), current);assert.equal(calls.length, count);
      });
      await check(`${kind}: klik sel baris terakhir membuka ID lain, bukan baris pertama`, async () => {
        row(last.id).querySelectorAll("td")[1].click();await wait(() => focused(last.id), "Baris terakhir tidak terpilih");
        assert.ok(location().endsWith(`${lower}=${last.id}`));
      });
      await check(`${kind}: nama duplikat tetap dipilih menurut ID`, async () => {
        opener(records[1].id).click();await wait(() => focused(records[1].id), "Nama kembar pertama tidak tepat");
        opener(records[2].id).click();await wait(() => focused(records[2].id), "Nama kembar kedua tidak tepat");
        assert.equal(host.querySelectorAll("[data-device-row]").length, records.length);
      });
      await check(`${kind}: filter dipertahankan dan kembali aman bila baris dipilih tersembunyi`, async () => {
        fill(host.querySelector('input[placeholder^="Cari"]'), first.name);await wait(() => host.querySelectorAll("[data-device-row]").length === 1, "Pencarian belum diterapkan");
        assert.equal(heading().dataset.deviceId, String(records[2].id));
        button(`Kembali ke daftar ${kind}`).click();await wait(() => document.activeElement?.getAttribute("aria-label") === `Daftar ${kind}`, "Fallback daftar tidak fokus");
        assert.equal(host.querySelector('input[placeholder^="Cari"]').value, first.name);
        button(`Ke area input ${kind}`).click();await wait(() => focused(records[2].id), "Shortcut perangkat terpilih hilang setelah filter");
      });
      await check(`${kind}: Edit/Hapus batal tidak memilih baris atau menggulir editor`, async () => {
        await mount(`/${lower}`);let count = scrolls.length;
        row(first.id).querySelector('button[title^="Edit"]').click();await wait(() => host.querySelector('[role="dialog"]'), "Form edit tidak terbuka");
        assert.ok(host.querySelector('[role="dialog"]').contains(document.activeElement));assert.equal(location(), `/${lower}`);assert.equal(scrolls.length, count);
        host.querySelector('[aria-label="Tutup"]').click();await wait(() => !host.querySelector('[role="dialog"]'), "Form edit tidak tutup");
        row(first.id).querySelector('button[title^="Hapus"]').click();await delay();flushFrames();assert.equal(location(), `/${lower}`);assert.equal(scrolls.length, count);assert.ok(!editor());
      });
      await check(`${kind}: deep link menunggu data dan History back/forward mengikuti ID`, async () => {
        await mount(`/${lower}?${lower}=${first.id}`);await wait(() => focused(first.id), "Deep link tidak fokus setelah data dimuat");
        opener(last.id).click();await wait(() => focused(last.id), "Perangkat kedua gagal");
        button("History back").click();await wait(() => focused(first.id), "Back tidak mengikuti ID lama");
        button("History forward").click();await wait(() => focused(last.id), "Forward tidak mengikuti ID berikutnya");
      });
      await check(`${kind}: modal core tidak direbut fokus atau diubah oleh navigasi latar`, async () => {
        await wait(() => host.querySelector('button[title^="Core 1 ·"]:not(:disabled)'), "Core belum siap");
        host.querySelector('button[title^="Core 1 ·"]').click();await wait(() => host.querySelector('[role="dialog"]'), "Modal core belum terbuka");
        const dialog = host.querySelector('[role="dialog"]'), count = scrolls.length, url = location();
        opener(first.id).click();button("Core").click();flushFrames();
        assert.equal(location(), url);assert.equal(scrolls.length, count);assert.ok(dialog.contains(document.activeElement));
        host.querySelector('[aria-label="Tutup"]').click();await wait(() => !host.querySelector('[role="dialog"]'), "Modal core belum tertutup");
        assert.equal(scrolls.length, count);
      });
      await check(`${kind}: peran baca tetap bisa navigasi tanpa kontrol tulis`, async () => {
        await mount(`/${lower}?${lower}=${first.id}${kind === "ODC" ? "&edit=1" : ""}`, { reader: true });await wait(() => focused(first.id), "Deep link pembaca tidak fokus");
        assert.ok(editor().textContent.includes("Mode baca"));assert.ok(!row(first.id).querySelector('button[title^="Edit"]'));assert.ok(!button(`Tambah ${kind}`));
        for (const core of host.querySelectorAll('button[title^="Core "]')) assert.ok(core.disabled);
        button("Core").click();await wait(() => document.activeElement?.getAttribute("aria-label") === `Core ${kind} ${first.name}`, "Pembaca tidak bisa melihat core");
      });
    }
    await check("ODC: query edit membuka modal tanpa scroll latar, tutup tidak melompat", async () => {
      const count = scrolls.length;await mount(`/odc?odc=${odcs[0].id}&edit=1`);
      await wait(() => host.querySelector('[role="dialog"]')?.contains(document.activeElement), "Query edit tidak membuka/fokus form");assert.equal(scrolls.length, count);
      host.querySelector('[aria-label="Tutup"]').click();await wait(() => !host.querySelector('[role="dialog"]'), "Modal belum tutup");flushFrames();assert.equal(scrolls.length, count);
    });
    await check("ODC/ODP: ID tidak ada tidak membuat editor atau request core buatan", async () => {
      for (const kind of ["odc", "odp"]) { const count = scrolls.length;await mount(`/${kind}?${kind}=99999999`);assert.ok(!editor());assert.equal(scrolls.length, count); }
      assert.ok(calls.every(call => !call.url.includes("99999999")));
    });
    await check("StrictMode: mount dengan ID siap tetap melakukan tepat satu navigasi", async () => {
      const count = scrolls.length;render(<StrictMode><HookHarness /></StrictMode>);
      await wait(() => document.activeElement === host.querySelector("h2"), "StrictMode membatalkan navigasi seluruhnya");assert.equal(scrolls.length, count + 1);
    });
    await check("refresh ID sama tidak mencuri fokus, pilihan cepat hanya ke ID terakhir", async () => {
      const count = scrolls.length;const refresh = host.querySelector("[data-refresh]");refresh.focus();refresh.click();await delay();flushFrames();assert.equal(scrolls.length, count);assert.equal(document.activeElement, refresh);
      host.querySelector('[data-open="2"]').click();host.querySelector('[data-open="3"]').click();
      await wait(() => host.querySelector("h2").dataset.hookId === "3" && document.activeElement === host.querySelector("h2"), "Pilihan cepat fokus ID salah");assert.equal(scrolls.length, count + 1);
    });
    await check("unmount membatalkan frame, modal/query yang diblokir tidak dijalankan kemudian", async () => {
      render(<HookHarness />);await wait(() => frames.size > 0, "Frame navigasi tidak dijadwalkan", false);const count = scrolls.length;unmount();flushFrames();assert.equal(scrolls.length, count);
      render(<HookHarness blocked />);await delay();flushFrames();assert.equal(scrolls.length, count);
      root.render(<HookHarness blocked={false} />);await delay();flushFrames();assert.equal(scrolls.length, count);
    });
    await check("seluruh navigasi read-only dan tidak ada error render React", async () => {
      assert.ok(calls.length > 30);assert.ok(calls.every(call => call.method === "GET"));
      assert.ok(!errors.some(error => /Each child|same key|uncontrolled|is not defined|Cannot read|not a function|change in the order of Hooks|Objects are not valid|Maximum update/.test(error)), errors.join("\n"));
    });
    console.log(`\nNAVIGASI ODC/ODP DOM: ${passed} pemeriksaan lulus.\n`);
  } finally { unmount();globalThis.fetch = originalFetch;console.error = originalError; }
}
