import assert from "node:assert/strict";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import App from "../src/App.jsx";
import { AuthProvider } from "../src/lib/auth.jsx";
import { setMemToken } from "../src/lib/api.js";

export async function run({ request, admin, reader, fixture: f, emptyData }) {
  const originalFetch = window.fetch, originalError = console.error;
  const errors = [], releases = [];
  let root, host, navigate, passed = 0;
  const delay = n => new Promise(r => setTimeout(r, n));
  const text = () => host?.textContent || "";
  const urlOf = u => new URL(String(u), window.location.href);
  const fetchWith = fn => { window.fetch = globalThis.fetch = fn; };
  const device = id => host.querySelector(`[data-olt-device="${id}"]`);
  const card = id => host.querySelector(`[data-olt-card="${id}"]`);
  // Baca angka utamanya, bukan gabungan angka dengan catatan feeder di bawahnya.
  const numbers = id => [...card(id).querySelectorAll("td")].map(c => Number.parseInt(c.firstChild.textContent, 10));
  const refresh = () => host.querySelector('button[aria-label="Muat ulang dashboard"]');
  const button = label => [...host.querySelectorAll("button")].find(b => b.textContent.trim() === label);
  const click = el => { assert.ok(el, "Kontrol tersedia"); assert.ok(!el.disabled, "Kontrol aktif"); el.click(); };
  console.error = (...args) => errors.push(args.map(String).join(" "));
  const catchError = e => { errors.push(String(e.error || e.message)); e.preventDefault(); };
  window.addEventListener("error", catchError);
  function gate() { let release; const promise = new Promise(r => { release = r; }); releases.push(release); return { promise, release }; }
  async function waitFor(check, message = "UI belum siap") {
    const start = Date.now(); while (Date.now() - start < 5000) { if (check()) return; await delay(15); }
    throw Error(`${message}: ${text().slice(-900)}`);
  }
  function Probe() { const location = useLocation(); navigate = useNavigate(); return <output data-route>{location.pathname}{location.search}</output>; }
  function session(who = admin) {
    setMemToken(null); localStorage.clear();
    localStorage.setItem("fiberops_arena_token", who.token);
    localStorage.setItem("fiberops_arena_user", JSON.stringify(who.user));
  }
  async function mount() {
    root?.unmount(); host?.remove(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    root.render(<MemoryRouter initialEntries={["/dashboard"]}><Probe /><AuthProvider><App /></AuthProvider></MemoryRouter>);
    await waitFor(() => host.querySelector("[data-route]"));
  }
  const ready = () => waitFor(() => card(f.a1.id) && !refresh()?.disabled);
  async function check(name, test) {
    session();
    try { await test(); passed++; console.log(`  OK    ${name}`); }
    finally {
      for (const release of releases.splice(0)) release();
      fetchWith(originalFetch); root?.unmount(); root = null; await delay(25);
    }
  }
  console.log("=== UJI UI DASHBOARD ===");
  try {
    await check("menampilkan nama/model, jumlah tipe card, posisi dan angka masing-masing card", async () => {
      await mount(); await ready();
      assert.equal(host.querySelector("h1").textContent, "Dashboard");
      assert.ok(device(f.A.id).querySelector("summary").textContent.includes("ZTE C300"));
      assert.ok(device(f.B.id).querySelector("summary").textContent.includes("ZTE C320"));
      assert.ok(device(f.A.id).textContent.includes("2× GTGO")); assert.ok(device(f.A.id).textContent.includes("1× GTHG"));
      assert.ok(device(f.B.id).textContent.includes("1× GTGH"));
      assert.ok(card(f.a1.id).textContent.includes("Shelf 1 · Slot 1")); assert.ok(card(f.a3.id).textContent.includes("Shelf 2 · Slot 1"));
      assert.deepEqual(numbers(f.a1.id), [8, 5, 2, 2]); assert.deepEqual(numbers(f.a2.id), [16, 2, 1, 0]); assert.deepEqual(numbers(f.a3.id), [8, 0, 0, 0]);
      assert.ok(card(f.a1.id).querySelector("td:last-child").textContent.includes("1 feeder belum dipetakan"));
    });
    await check("ringkasan lama, Status Core, dan penjelasan status manual versus mapping tetap terbaca", async () => {
      await mount(); await ready();
      for (const label of ["Core Terdaftar", "Sambungan Core ODC→ODP", "Splitter", "Status Core", "Card terpasang", "Port tercatat", "Port Aktif", "Port terpakai"]) assert.ok(text().includes(label), label);
      assert.ok(text().includes("status port yang dicatat manual")); assert.ok(text().includes("dipetakan ke core feeder"));
      assert.ok(text().includes("bukan dijumlahkan")); assert.ok(text().includes("bukan pemantauan langsung"));
      assert.ok(!text().includes("NaN"));
    });
    await check("HSGQ port bawaan tidak menampilkan card/shelf/slot fiktif", async () => {
      await mount(); await ready();
      const fixed = device(f.fixed.id); assert.ok(fixed.textContent.includes("Port bawaan OLT")); assert.ok(fixed.textContent.includes("tanpa card terpisah"));
      assert.ok(!/BUILTIN|Shelf|Slot/.test(fixed.textContent));
      assert.equal(fixed.querySelectorAll("tbody tr").length, 1);
      assert.deepEqual([...fixed.querySelectorAll("tbody td")].map(c => Number.parseInt(c.textContent, 10)), [4, 2, 1, 1]);
      assert.ok(device(f.empty.id).textContent.includes("Belum ada card yang tercatat"));
    });
    await check("rincian dapat dilipat tanpa menghilangkan ringkasan OLT dan angka aktif/terpakai", async () => {
      await mount(); await ready();
      const detail = device(f.A.id), summary = detail.querySelector("summary"); assert.ok(detail.open);
      click(summary); assert.equal(detail.open, false); assert.ok(summary.textContent.includes("3 aktif")); assert.ok(summary.textContent.includes("2 terpakai"));
      click(summary); assert.equal(detail.open, true);
    });
    await check("tautan rincian membuka OLT yang tepat dan interface-nya, bukan perangkat lain", async () => {
      await mount(); await ready();
      const link = device(f.A.id).querySelector("a"); assert.equal(link.getAttribute("href"), `/olt?olt=${f.A.id}`); click(link);
      await waitFor(() => host.querySelector("h1")?.textContent === "Manajemen OLT" && text().includes("GPON 1/1/1"));
      assert.equal(host.querySelector("[data-route]").textContent, `/olt?olt=${f.A.id}`);
      assert.ok([...host.querySelectorAll("h2")].some(h => h.textContent.includes("Interface OLT — OLT-001")));
    });
    await check("tabel memiliki header dan nama aksesibel; gulir horizontal dibatasi di dalam panel", async () => {
      await mount(); await ready();
      const table = device(f.A.id).querySelector("table"); assert.equal(table.getAttribute("aria-label"), "Rincian card dan port OLT-001");
      assert.deepEqual([...table.querySelectorAll("thead th")].map(c => [c.textContent, c.getAttribute("scope")]), [["Card / posisi", "col"], ["Kapasitas", "col"], ["Tercatat", "col"], ["Aktif", "col"], ["Terpakai", "col"]]);
      assert.ok(table.closest(".overflow-x-auto")); assert.ok(table.querySelector('tbody th[scope="row"]'));
    });
    await check("loading tidak disamakan dengan inventaris kosong", async () => {
      const hold = gate(); let captured = false;
      fetchWith(async (u, o) => { if (urlOf(u).pathname !== "/api/dashboard") return originalFetch(u, o); captured = true; await hold.promise; return originalFetch(u, o); });
      await mount(); await waitFor(() => captured && refresh()?.disabled);
      assert.ok(host.querySelector('[role="status"]')?.textContent.includes("Memuat ringkasan")); assert.ok(!text().includes("Belum ada OLT yang tercatat"));
      hold.release(); await ready();
    });
    await check("inventaris benar-benar kosong menampilkan petunjuk tanpa card/port contoh", async () => {
      fetchWith((u, o) => urlOf(u).pathname === "/api/dashboard" ? Promise.resolve(Response.json(emptyData)) : originalFetch(u, o));
      await mount(); await waitFor(() => text().includes("Belum ada OLT yang tercatat"));
      assert.equal(host.querySelectorAll("[data-olt-device]").length, 0); assert.ok(!text().includes("OLT-001")); assert.ok(!text().includes("NaN"));
    });
    await check("gagal muat pertama menunjukkan error dan retry, bukan angka nol palsu", async () => {
      fetchWith((u, o) => urlOf(u).pathname === "/api/dashboard" ? Promise.resolve(Response.json({ error: "Dashboard sementara tidak tersedia" }, { status: 503 })) : originalFetch(u, o));
      await mount(); await waitFor(() => button("Coba lagi"));
      assert.ok(host.querySelector('[role="alert"]').textContent.includes("Dashboard sementara tidak tersedia")); assert.ok(!text().includes("Belum ada OLT yang tercatat"));
      fetchWith(originalFetch); click(button("Coba lagi")); await ready(); assert.ok(!host.querySelector('[role="alert"]'));
    });
    await check("Muat ulang mengambil perubahan status nyata dan mengunci tombol saat menunggu", async () => {
      await mount(); await ready(); assert.deepEqual(numbers(f.a1.id), [8, 5, 2, 2]);
      const hold = gate(); let captured = false;
      try {
        await request("PATCH", `/api/ports/${f.aPorts[1].id}`, { status: "inactive" });
        fetchWith(async (u, o) => { if (urlOf(u).pathname !== "/api/dashboard") return originalFetch(u, o); captured = true; await hold.promise; return originalFetch(u, o); });
        click(refresh()); await waitFor(() => captured && refresh().disabled); assert.deepEqual(numbers(f.a1.id), [8, 5, 2, 2]);
        hold.release(); await waitFor(() => !refresh().disabled && numbers(f.a1.id)[2] === 1); assert.deepEqual(numbers(f.a1.id), [8, 5, 1, 2]);
      } finally { hold.release(); await request("PATCH", `/api/ports/${f.aPorts[1].id}`, { status: "active" }); }
    });
    await check("gagal refresh mempertahankan angka terakhir dengan peringatan yang jelas", async () => {
      await mount(); await ready();
      fetchWith((u, o) => urlOf(u).pathname === "/api/dashboard" ? Promise.reject(Error("Koneksi dashboard terputus")) : originalFetch(u, o));
      click(refresh()); await waitFor(() => text().includes("Ringkasan terakhir masih ditampilkan"));
      assert.deepEqual(numbers(f.a1.id), [8, 5, 2, 2]); assert.ok(host.querySelector('[role="alert"]').textContent.includes("Koneksi dashboard terputus"));
      fetchWith(originalFetch); click(refresh()); await ready(); assert.ok(!host.querySelector('[role="alert"]'));
    });
    await check("nama, label dan posisi mengikuti inventaris terbaru dengan ID dan tautan yang stabil", async () => {
      await mount(); await ready();
      try {
        await request("PATCH", `/api/olts/${f.A.id}`, { name: "OLT-RENAMED" });
        await request("PATCH", `/api/cards/${f.a1.id}`, { shelf: 3, slot: 7, label: "Card <uji> & lapangan" });
        click(refresh()); await waitFor(() => card(f.a1.id)?.textContent.includes("Shelf 3 · Slot 7"));
        assert.ok(device(f.A.id).querySelector("summary").textContent.includes("OLT-RENAMED")); assert.ok(card(f.a1.id).textContent.includes("Card <uji> & lapangan"));
        assert.ok(!card(f.a1.id).querySelector("uji")); assert.equal(device(f.A.id).querySelector("a").getAttribute("href"), `/olt?olt=${f.A.id}`);
        assert.deepEqual(numbers(f.a1.id), [8, 5, 2, 2]);
      } finally {
        await request("PATCH", `/api/olts/${f.A.id}`, { name: "OLT-001" });
        await request("PATCH", `/api/cards/${f.a1.id}`, { shelf: 1, slot: 1, label: null });
      }
    });
    await check("respons dashboard lama tidak mencemari halaman setelah navigasi/pergantian mount", async () => {
      const hold = gate(); let captured = false, first = true;
      fetchWith(async (u, o) => {
        const res = await originalFetch(u, o);
        if (urlOf(u).pathname === "/api/dashboard" && first) { first = false; captured = true; await hold.promise; }
        return res;
      });
      await mount(); await waitFor(() => captured); navigate(`/olt?olt=${f.B.id}`);
      await waitFor(() => host.querySelector("h1")?.textContent === "Manajemen OLT");
      navigate("/dashboard"); await ready(); hold.release(); await delay(80);
      assert.equal(host.querySelector("h1").textContent, "Dashboard"); assert.deepEqual(numbers(f.a1.id), [8, 5, 2, 2]);
    });
    await check("backend lama tanpa rincian tidak ditampilkan sebagai inventaris kosong atau Terpakai=0", async () => {
      const legacy = await request("GET", "/api/dashboard"); delete legacy.oltDevices; delete legacy.portsUsed; delete legacy.portCapacity;
      fetchWith((u, o) => urlOf(u).pathname === "/api/dashboard" ? Promise.resolve(Response.json(legacy)) : originalFetch(u, o));
      await mount(); await waitFor(() => text().includes("Rincian perangkat belum tersedia dari API"));
      assert.ok(text().includes("Pastikan backend sudah diperbarui")); assert.ok(text().includes("—")); assert.ok(!text().includes("Belum ada OLT yang tercatat"));
    });
    await check("role user dapat membaca, menyegarkan dan membuka OLT tanpa kontrol edit", async () => {
      session(reader); await mount(); await ready(); click(refresh()); await ready();
      assert.deepEqual(numbers(f.a1.id), [8, 5, 2, 2]); click(device(f.A.id).querySelector("a"));
      await waitFor(() => host.querySelector("h1")?.textContent === "Manajemen OLT" && text().includes("GPON 1/1/1"));
      assert.ok(!button("Tambah OLT")); assert.ok(!button("Tambah Card")); assert.ok(!host.querySelector('button[title^="Edit OLT"]'));
    });
    await check("tidak ada error React, key duplikat atau exception selama pengujian", () => assert.deepEqual(errors, []));
    console.log(`DASHBOARD UI: ${passed} kasus lolos.\n`);
  } finally {
    for (const release of releases) release(); fetchWith(originalFetch); root?.unmount(); host?.remove();
    window.removeEventListener("error", catchError); console.error = originalError;
  }
}
