import assert from "node:assert/strict";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "../src/lib/auth.jsx";
import Peta from "../src/pages/Peta.jsx";
import { odpDetailSnapshot } from "./fixtures/odp-connections.mjs";

function FakeCanvas(props) {
  return <div data-map-stub>{props.points.map(node => <div key={node.key}>
    <button data-marker={node.key} onClick={() => props.onSelect(node.key)}>{node.name}</button>
    <button data-popup-detail={node.key} onClick={() => props.onShowDetail(node.key)}>Lihat detail</button>
  </div>)}</div>;
}
function Page() { const { user, status } = useAuth(); return status === "ready" && user ? <Peta MapCanvasComponent={FakeCanvas} /> : null; }
export async function run() {
  let root, host, calls, role, failure, wrongId, invalid, pending, currentSnapshot;
  const holds = [], errors = [], originalError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  let passed = 0;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const dialog = () => host.querySelector('[role="dialog"]');
  const detail = () => host.querySelector('[data-odp-connection-detail]');
  const text = () => dialog()?.textContent || "";
  async function wait(fn, message) { const start = Date.now(); while (Date.now() - start < 5000) { if (fn()) return; await delay(10); } throw Error(`${message}: ${host.textContent.slice(-1200)}`); }
  async function check(name, fn) { await fn(); passed++; console.log("OK   ", name); }
  const button = name => [...host.querySelectorAll("button")].find(b => b.textContent.trim() === name);
  function click(el) { assert.ok(el); el.focus(); el.click(); }
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  async function transport(url, options = {}) {
    const route = String(url), method = options.method || "GET";
    calls.push({ route, method });
    assert.equal(method, "GET", "Detail tidak boleh menulis inventaris");
    if (route === "/api/me") return response({ user: { id: 1, full_name: "Pengguna UJI", role } });
    if (route === "/api/route-imports") return response({ version: 1, imports: [] });
    if (route === "/api/map-data") { const { odpDetail, ...snapshot } = odpDetailSnapshot(); return response(snapshot); }
    const match = route.match(/^\/api\/map-data\?odp_id=(\d+)$/);
    if (match) {
      const selected = Number(match[1]), snapshot = currentSnapshot ? structuredClone(currentSnapshot) : odpDetailSnapshot(selected);
      if (pending === selected) await new Promise(resolve => holds.push(resolve));
      if (failure) return response({ error: failure === 404 ? "ODP tidak ditemukan; muat ulang peta" : "Snapshot detail UJI gagal" }, failure);
      if (wrongId) snapshot.odpDetail.odpId = 202;
      if (invalid) snapshot.ports = null;
      return response(snapshot);
    }
    throw Error(`Unexpected request: ${route}`);
  }
  async function mount(nextRole = "admin") {
    root?.unmount(); host?.remove();
    for (const release of holds.splice(0)) release();
    await delay(10);
    role = nextRole; calls = []; failure = null; wrongId = false; invalid = false; pending = null; currentSnapshot = null;
    localStorage.setItem("fiberops_arena_token", "fixture-header-only");
    localStorage.setItem("fiberops_arena_user", JSON.stringify({ id: 1, role: "admin" }));
    globalThis.fetch = transport;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    root.render(<MemoryRouter><AuthProvider><Page /></AuthProvider></MemoryRouter>);
    await wait(() => host.querySelector("[data-map-stub]"), "Peta belum siap");
  }
  async function open(id = 101, from = "popup") {
    click(from === "popup" ? host.querySelector(`[data-popup-detail="odp-${id}"]`) : host.querySelector(`[aria-label="Detail ODP #${id}"]`));
    await wait(() => dialog(), "Modal detail belum terbuka");
    if (!failure && !wrongId && !invalid && pending !== id) await wait(() => detail()?.dataset.odpConnectionDetail === String(id), "Data detail belum tampil");
  }
  async function close() { click(dialog().querySelector('[aria-label="Tutup"]')); await wait(() => !dialog(), "Modal belum ditutup"); }
  try {
    await mount();
    await check("peta dan klik marker tidak memuat core/detail atau mengirim sembilan GET tambahan", async () => {
      assert.equal(calls.filter(c => c.route.includes("?odp_id=")).length, 0);
      click(host.querySelector('[data-marker="odp-101"]'));
      await wait(() => host.querySelector('[data-selected-device="odp-101"]'), "Pemilihan marker");
      assert.equal(calls.filter(c => c.route.includes("?odp_id=")).length, 0);
      assert.ok(!dialog());
    });
    await check("tombol detail sidebar membuka modal baca-saja dengan jalur C300, core dan warna/tube", async () => {
      click(button("Lihat detail sambungan ODP"));
      await wait(() => detail(), "Detail sidebar");
      assert.match(text(), /GPON 1\/2\/1/); assert.match(text(), /SPL-UJI-RECEIVER/); assert.match(text(), /Output 3/);
      const summary = dialog().querySelector('[aria-label="Ringkasan sambungan ODP"]');
      assert.match(summary.textContent, /OLT-UJI-C300 · GPON 1\/2\/1/);
      assert.match(summary.textContent, /ODC-UJI-PUSAT → ODC-UJI-ANAK/);
      assert.match(summary.textContent, /Core 7 · Biru · Tube 2/);
      assert.doesNotMatch(summary.textContent, /Core 3/); // Cadangan tetap hanya pada daftar lengkap.
      assert.match(text(), /PELANGGAN-UJI-A/); assert.match(text(), /Catatan core A sintetis/);
      const power = host.querySelector('[data-odp-power-core="7"]');
      assert.match(power.textContent, /Biru/); assert.match(power.textContent, /Tube 2/); assert.match(power.textContent, /Terpakai/);
      assert.equal(dialog().querySelectorAll("input,select,textarea,form").length, 0);
      assert.equal(calls.filter(c => c.route.includes("?odp_id=")).length, 1);
      assert.ok(dialog().querySelector('a[href="/odp?odp=101"]'));
      assert.match(text(), /bukan pengukuran dBm/);
    });
    await check("Escape menutup modal, mengembalikan fokus, dan tidak mengunci scroll", async () => {
      await delay(20); assert.equal(document.body.style.overflow, "hidden");
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await wait(() => !dialog() && document.body.style.overflow !== "hidden", "Escape detail");
      assert.equal(document.activeElement.textContent, "Lihat detail sambungan ODP");
    });
    await check("ringkasan tidak menyatukan dua jalur yang kebetulan memakai interface OLT sama", async () => {
      currentSnapshot = odpDetailSnapshot();
      currentSnapshot.splitters[2].outputs.push({ id: 32, port: 4, target_type: "odp", target_odp_id: 101 });
      await open();
      const summary = dialog().querySelector('[aria-label="Ringkasan sambungan ODP"]');
      assert.equal((summary.textContent.match(/OLT-UJI-C300 · GPON 1\/2\/1/g) || []).length, 2);
      assert.equal(dialog().querySelectorAll('[data-odp-route="mapped"]').length, 2);
      await close(); currentSnapshot = null;
    });
    await check("Lihat detail popup memakai ID: nama sama tidak menampilkan core/OLT ODP lain", async () => {
      await open(202);
      assert.match(text(), /OLT-UJI-C320/); assert.match(text(), /GPON 1\/1\/1/); assert.match(text(), /Catatan core B sintetis/);
      assert.doesNotMatch(text(), /Catatan core A sintetis|PELANGGAN-UJI-A|GPON 1\/2\/1/);
      await close();
    });
    await check("Detail daftar ODP tanpa GPS tetap bekerja tanpa mengarang asal interface", async () => {
      await open(303, "list"); assert.match(text(), /Belum ada sambungan menuju ODP/); assert.match(text(), /bukan bukti asal fisik/);
      assert.equal(dialog().querySelectorAll("[data-odp-route]").length, 0); await close();
    });
    await check("refresh membaca satu snapshot baru dan tidak mempertahankan mapping/core lama", async () => {
      await open();
      currentSnapshot = odpDetailSnapshot(); currentSnapshot.interfaceMappings = []; currentSnapshot.odpDetail.cores[0].notes = "Catatan A setelah refresh";
      const before = calls.length; click(button("Muat ulang detail"));
      await wait(() => text().includes("Catatan A setelah refresh"), "Refresh detail");
      assert.doesNotMatch(text(), /GPON 1\/2\/1/); assert.match(text(), /Interface asal belum dipetakan/);
      assert.equal(calls.length, before + 1); currentSnapshot = null; await close();
    });
    await check("snapshot error ditampilkan, retry memuat detail tanpa menulis", async () => {
      failure = 503; await open(); await wait(() => text().includes("Snapshot detail UJI gagal"), "Error detail");
      assert.equal(detail(), null); failure = null; click(button("Coba lagi detail")); await wait(() => detail(), "Retry detail"); await close();
    });
    await check("ODP dihapus menghasilkan pesan 404, bukan detail kosong palsu", async () => {
      failure = 404; await open(); await wait(() => text().includes("ODP tidak ditemukan"), "404 detail"); assert.equal(detail(), null); await close(); failure = null;
    });
    await check("snapshot salah ID/rusak tidak ditampilkan untuk perangkat terpilih", async () => {
      for (const kind of ["id", "payload"]) {
        wrongId = kind === "id"; invalid = kind === "payload"; await open();
        await wait(() => dialog().querySelector('[role="alert"]'), "Penolakan snapshot"); assert.equal(detail(), null); await close();
      }
      wrongId = false; invalid = false;
    });
    await check("respons A yang lambat setelah tutup lalu buka B tidak mengisi modal B", async () => {
      pending = 101; await open(101); await wait(() => holds.length, "Request tertahan"); await close();
      pending = null; await open(202); holds.splice(0).forEach(resolve => resolve()); await delay(60);
      assert.equal(detail().dataset.odpConnectionDetail, "202"); assert.doesNotMatch(text(), /Catatan core A sintetis/); await close();
    });
    await check("tutup saat loading mengabaikan respons terlambat dan melepaskan scroll", async () => {
      pending = 101; await open(); await wait(() => holds.length, "Request tertahan kedua"); await close();
      holds.splice(0).forEach(resolve => resolve()); pending = null; await delay(50);
      assert.ok(!dialog()); assert.equal(document.body.style.overflow, "");
    });
    for (const nextRole of ["operator", "user"]) await check(`${nextRole}: detail dapat dibaca tanpa form tulis walau cache mengaku admin`, async () => {
      await mount(nextRole); await open();
      assert.equal(dialog().querySelectorAll("input,select,textarea,form").length, 0);
      assert.ok(calls.every(c => c.method === "GET"));
      if (nextRole === "user") assert.equal([...host.querySelectorAll("button")].filter(b => /Atur GPS|Atur koordinat/.test(b.textContent)).length, 0);
      await close();
    });
    await check("nama/catatan berisi HTML tetap teks, tidak dieksekusi", async () => {
      currentSnapshot = odpDetailSnapshot(); currentSnapshot.odps.find(p => p.id === 101).name = '<img src=x onerror="alert(1)">'; currentSnapshot.odpDetail.cores[0].notes = '<script>alert(2)</script>';
      await open(); assert.match(text(), /<script>/); assert.match(text(), /<img/); assert.equal(dialog().querySelectorAll("script,img[src=x]").length, 0); await close();
    });
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(`\nDETAIL ODP UI: ${passed} pemeriksaan lulus.`);
  } finally {
    holds.splice(0).forEach(resolve => resolve()); root?.unmount(); host?.remove(); await delay(30); console.error = originalError;
  }
}
