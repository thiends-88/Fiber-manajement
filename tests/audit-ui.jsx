import assert from "node:assert/strict";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import App from "../src/App.jsx";
import { AuthProvider, useAuth } from "../src/lib/auth.jsx";
import { setMemToken } from "../src/lib/api.js";
import { Toast, useToast } from "../src/components/ui.jsx";

export async function run({ request, admin, reader, fixtures: [A, B], hardware: [H1, H2], clearCookies, setCookie }) {
  const originalFetch = window.fetch, originalError = console.error;
  const errors = [], releases = [];
  let root, host, navigate, passed = 0, failed = 0;
  const delay = n => new Promise(r => setTimeout(r, n));
  const text = () => host?.textContent || "";
  console.error = (...args) => errors.push(args.map(String).join(" "));
  const catchError = e => { errors.push(String(e.error || e.message)); e.preventDefault(); };
  window.addEventListener("error", catchError);
  const fetchWith = fn => { window.fetch = globalThis.fetch = fn; };
  const urlOf = u => new URL(String(u), window.location.href);
  function gate() { let release; const promise = new Promise(r => { release = r; }); releases.push(release); return { promise, release }; }
  async function waitFor(check, message = "UI belum siap") {
    const start = Date.now();
    while (Date.now() - start < 5000) { if (check()) return; await delay(15); }
    throw Error(`${message}; ${text().slice(-900)}`);
  }
  function Probe() { const location = useLocation(); navigate = useNavigate(); return <output data-route>{location.pathname}{location.search}</output>; }
  function SessionHarness() {
    const auth = useAuth();
    return <><output data-session>{auth.status}:{auth.user?.role || "none"}</output><button onClick={() => auth.signIn("audit-reader@test.local", "Audit123!").catch(e => errors.push(e.message))}>Login Reader</button></>;
  }
  function ToastHarness() {
    const [a, setA] = useState(null), [b, setB] = useState(null), toastA = useToast(setA), toastB = useToast(setB);
    return <><button onClick={() => toastA("Pesan-A")}>Toast A</button><button onClick={() => toastB("Pesan-B")}>Toast B</button><Toast toast={a} /><Toast toast={b} /></>;
  }
  function session(actual = admin, cachedUser = actual?.user) {
    setMemToken(null); localStorage.clear(); clearCookies();
    if (actual?.token) localStorage.setItem("fiberops_arena_token", actual.token);
    if (cachedUser) localStorage.setItem("fiberops_arena_user", JSON.stringify(cachedUser));
  }
  async function mount(route, component = <App />) {
    root?.unmount(); host?.remove(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    root.render(<MemoryRouter initialEntries={[route]}><Probe /><AuthProvider>{component}</AuthProvider></MemoryRouter>);
    await waitFor(() => host.querySelector("[data-route]"));
  }
  const button = name => [...host.querySelectorAll("button")].find(b => b.textContent.trim() === name);
  const core = n => host.querySelector(`button[title^="Core ${n} ·"]`);
  const row = name => [...host.querySelectorAll("tbody tr")].find(r => r.querySelector("td")?.textContent.trim() === name);
  const click = el => { assert.ok(el, "Elemen tersedia"); assert.ok(!el.disabled, "Elemen dapat digunakan"); el.click(); };
  function field(name) {
    const label = [...host.querySelectorAll(".modal-overlay label, label")].find(l => l.textContent.trim() === name || l.textContent.trim().startsWith(name));
    return label?.parentElement.querySelector("input,select,textarea");
  }
  async function change(el, value) {
    assert.ok(el, "Field tersedia");
    const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value)); el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); await delay(20);
  }
  const submit = () => host.querySelector(".modal-overlay form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  async function check(name, test) {
    try { session(); await test(); passed++; console.log(`  OK    ${name}`); }
    catch (e) { failed++; originalError(`  GAGAL ${name}: ${e.message}`); }
    finally { for (const release of releases.splice(0)) release(); fetchWith(originalFetch); root?.unmount(); root = null; await delay(25); }
  }
  console.log("\n=== AUDIT UI / PERGANTIAN PERANGKAT & SESI ===");
  try {
    await check("profil admin tersimpan bukan bukti login: sesi invalid kembali ke form login", async () => {
      session({ token: "token-tidak-valid", user: admin.user });
      await mount("/users"); await waitFor(() => host.querySelector("#login-email"), "Sesi invalid tidak kembali login");
      assert.ok(!button("Tambah User")); assert.equal(localStorage.getItem("fiberops_arena_user"), null);
    });
    await check("role server mengalahkan cache admin yang usang tanpa sempat membuka /users", async () => {
      session(reader, admin.user); let usersRequests = 0;
      fetchWith((u, o) => { if (urlOf(u).pathname === "/api/users") usersRequests++; return originalFetch(u, o); });
      await mount("/users"); await waitFor(() => host.querySelector("h1")?.textContent.includes("Alur Core"));
      assert.equal(usersRequests, 0); assert.ok(![...host.querySelectorAll("a")].some(a => a.getAttribute("href") === "/users"));
    });
    await check("boot menunggu /me, tidak menampilkan kontrol dari cache sebelum terverifikasi", async () => {
      session(admin, { ...admin.user, full_name: "Admin palsu dari cache" }); const hold = gate(); let captured = false;
      fetchWith(async (u, o) => { const r = await originalFetch(u, o); if (urlOf(u).pathname === "/api/me") { captured = true; await hold.promise; } return r; });
      await mount(`/odc?odc=${A.d.id}`); await delay(60);
      assert.ok(captured); assert.ok(!host.querySelector("h1")); assert.ok(!text().includes("Admin palsu"));
      hold.release(); await waitFor(() => button("Tambah ODC"));
    });
    await check("cookie HttpOnly dapat memulihkan sesi saat token/profil storage kosong", async () => {
      session(null); setCookie(`fiberops_token=${admin.token}; Path=/; HttpOnly; SameSite=Lax`);
      await mount("/dashboard"); await waitFor(() => host.querySelector("h1")?.textContent.includes("Dashboard")); assert.ok(!host.querySelector("#login-email"));
    });
    await check("gagal memeriksa sesi menunjukkan retry, bukan akses cache atau redirect berulang", async () => {
      fetchWith((u, o) => urlOf(u).pathname === "/api/me" ? Promise.reject(Error("Jaringan uji terputus")) : originalFetch(u, o));
      await mount("/dashboard"); await waitFor(() => text().includes("Sesi belum dapat diperiksa")); assert.ok(!host.querySelector("h1"));
      fetchWith(originalFetch); click(button("Coba lagi")); await waitFor(() => host.querySelector("h1")?.textContent.includes("Dashboard"));
    });
    await check("hasil boot lama (sukses ataupun 401) tidak menimpa login baru", async () => {
      for (const status of [200, 401]) {
        session(null); const hold = gate(); let captured = false;
        fetchWith(async (u, o) => { if (urlOf(u).pathname !== "/api/me") return originalFetch(u, o); captured = true; await hold.promise; return new Response(JSON.stringify(status === 200 ? { user: admin.user } : { error: "Sesi lama habis" }), { status }); });
        await mount("/", <SessionHarness />); await waitFor(() => captured); click(button("Login Reader"));
        await waitFor(() => host.querySelector("[data-session]")?.textContent === "ready:user"); hold.release(); await delay(80);
        assert.equal(host.querySelector("[data-session]").textContent, "ready:user"); assert.ok(localStorage.getItem("fiberops_arena_token"));
      }
    });
    await check("pemilih ODC Mapping mengubah URL dan hanya menampilkan sambungan kabinet terpilih", async () => {
      await mount(`/mapping?odc=${A.d.id}`); await waitFor(() => text().includes("closure-A"));
      await change(field("Pilih ODC"), B.d.id);
      await waitFor(() => host.querySelector("[data-route]").textContent.includes(`odc=${B.d.id}`) && text().includes("closure-B"));
      assert.ok(!text().includes("closure-A"));
      await change(field("Pilih ODC"), ""); await waitFor(() => !text().includes("closure-B")); assert.equal(field("Pilih ODC").value, "");
    });
    await check("respons link ODC lama tidak mencemari pilihan ODC yang lebih baru", async () => {
      const hold = gate();
      fetchWith(async (u, o) => { const r = await originalFetch(u, o); const url = urlOf(u); if (url.pathname === "/api/links" && url.searchParams.get("odc_id") === String(A.d.id)) await hold.promise; return r; });
      await mount(`/mapping?odc=${A.d.id}`); await waitFor(() => field("Pilih ODC")?.querySelector(`option[value="${B.d.id}"]`));
      await change(field("Pilih ODC"), B.d.id); await waitFor(() => text().includes("closure-B")); hold.release(); await delay(100);
      assert.ok(text().includes("closure-B")); assert.ok(!text().includes("closure-A"));
    });
    await check("core ODC dikunci saat memuat; respons lama dan modal tidak terbawa ke ODC lain", async () => {
      const hold = gate(); let captured = false;
      fetchWith(async (u, o) => { const r = await originalFetch(u, o), url = urlOf(u); if (url.pathname === "/api/cores" && url.searchParams.get("odc_id") === String(A.d.id)) { captured = true; await hold.promise; } return r; });
      await mount(`/odc?odc=${A.d.id}`); await waitFor(() => captured && core(3)); assert.ok(core(3).disabled);
      click(row(B.d.name)); await waitFor(() => core(3)?.title.includes("Reserved") && !core(3).disabled); hold.release(); await delay(100);
      assert.ok(core(3).title.includes("Reserved")); click(core(3)); await waitFor(() => field("Catatan")?.value === "Catatan-B");
      navigate(`/odc?odc=${A.d.id}`); await waitFor(() => !host.querySelector(".modal-overlay"));
    });
    await check("splitter dan form output tidak terbawa setelah berganti ODC dengan fetch tertunda", async () => {
      const hold = gate(); let captured = false;
      fetchWith(async (u, o) => { const r = await originalFetch(u, o), url = urlOf(u); if (url.pathname === "/api/splitters" && url.searchParams.get("odc_id") === String(A.d.id)) { captured = true; await hold.promise; } return r; });
      await mount(`/odc?odc=${A.d.id}`); await waitFor(() => captured && row(B.d.name)); click(row(B.d.name));
      await waitFor(() => text().includes(B.s.name) && !button("Tambah Splitter")?.disabled); hold.release(); await delay(80); assert.ok(!text().includes(A.s.name));
      click(host.querySelector('button[title="Output 1 (belum diarahkan)"]')); await waitFor(() => host.querySelector(".modal-overlay"));
      navigate(`/odc?odc=${A.d.id}`); await waitFor(() => !host.querySelector(".modal-overlay"));
    });
    await check("pergantian ODP juga membatalkan core/form yang berasal dari ODP lama", async () => {
      const hold = gate(); let captured = false;
      fetchWith(async (u, o) => { const r = await originalFetch(u, o), url = urlOf(u); if (url.pathname === "/api/cores" && url.searchParams.get("odp_id") === String(A.p.id)) { captured = true; await hold.promise; } return r; });
      await mount("/odp"); await waitFor(() => row(A.p.name)); click(row(A.p.name)); await waitFor(() => captured && core(3));
      click(row(B.p.name)); await waitFor(() => core(3)?.title.includes("Reserved") && !core(3).disabled); hold.release(); await delay(80);
      assert.ok(core(3).title.includes("Reserved")); click(core(3)); await waitFor(() => field("Catatan")?.value === "Catatan-B");
      click(row(A.p.name)); await waitFor(() => !host.querySelector(".modal-overlay"));
    });
    await check("reload sesudah simpan port tidak menimpa card/port OLT yang baru dipilih", async () => {
      const hold = gate(); let armed = false, captured = false;
      fetchWith(async (u, o) => {
        const r = await originalFetch(u, o), url = urlOf(u);
        if (armed && url.pathname === "/api/cards" && url.searchParams.get("olt_id") === String(H1.olt.id)) { captured = true; await hold.promise; }
        return r;
      });
      const portButton = label => host.querySelector(`button[title^="${label}:"]`);
      await mount(`/olt?olt=${H1.olt.id}`); await waitFor(() => portButton(H1.label)); click(portButton(H1.label));
      await waitFor(() => host.querySelector(".modal-overlay form")); await change(field("Catatan"), "Catatan port audit"); armed = true; submit();
      await waitFor(() => captured && !host.querySelector(".modal-overlay")); navigate(`/olt?olt=${H2.olt.id}`); await waitFor(() => portButton(H2.label));
      hold.release(); await delay(100); assert.ok(portButton(H2.label)); assert.ok(!portButton(H1.label));
    });
    await check("edit input splitter langsung memperbarui deteksi core, tanpa reload halaman", async () => {
      await mount(`/odc?odc=${B.d.id}`); await waitFor(() => host.querySelector('button[title="Edit splitter"]') && core(3) && !core(3).disabled);
      click(host.querySelector('button[title="Edit splitter"]')); await waitFor(() => host.querySelector(".modal-overlay"));
      await change(field("Input dari Core"), 3); submit();
      await waitFor(() => !host.querySelector(".modal-overlay") && core(3)?.title.includes(B.s.name) && !core(3).disabled);
      assert.ok(!core(2).title.includes(B.s.name));
      const feederCard = () => [...host.querySelectorAll("h2")].find(h => h.textContent === "Interface OLT → Core Feeder")?.closest(".card");
      await waitFor(() => [...(feederCard()?.querySelectorAll("tbody tr td:first-child") || [])].some(el => el.textContent.includes("Core 3")));
      assert.ok(![...feederCard().querySelectorAll("tbody tr td:first-child")].some(el => el.textContent.includes("Core 2")));
    });
    await check("simpan core memperbarui jumlah pada daftar ODC; label form terhubung ke input", async () => {
      await mount(`/odc?odc=${B.d.id}`); await waitFor(() => core(4) && !core(4).disabled); assert.equal(row(B.d.name).children[5].textContent, "1");
      click(core(4)); await waitFor(() => host.querySelector(".modal-overlay"));
      const status = field("Status"), label = [...host.querySelectorAll(".modal-overlay label")].find(l => l.textContent === "Status");
      assert.equal(label.htmlFor, status.id); assert.ok(status.id);
      await change(status, "used"); submit(); await waitFor(() => !host.querySelector(".modal-overlay") && row(B.d.name).children[5].textContent === "2");
    });
    await check("field form ODP/user tidak dapat diedit atau ditutup saat save tertunda", async () => {
      for (const kind of ["odp", "users"]) {
        const hold = gate(); let pending = false;
        fetchWith(async (u, o) => {
          if (urlOf(u).pathname === `/api/${kind === "odp" ? "odps" : "users"}` && o?.method === "POST") { pending = true; await hold.promise; }
          return originalFetch(u, o);
        });
        await mount(`/${kind}`);
        await waitFor(() => kind === "odp" ? row(B.p.name) : button("Tambah User"));
        click(button(kind === "odp" ? "Tambah ODP" : "Tambah User"));
        await waitFor(() => host.querySelector('[role="dialog"] form'));
        if (kind === "odp") { await change(field("Nama ODP"), "ODP-FIELD-BUSY-AUDIT"); await change(field("Induk ODC"), B.d.id); }
        else { await change(field("Email"), "busy-field-audit@test.local"); await change(field("Password"), "Audit123!"); await change(field("Nama Lengkap"), "User field busy"); }
        submit(); await waitFor(() => pending && button("Menyimpan…"));
        const dialog = host.querySelector('[role="dialog"]');
        for (const control of dialog.querySelectorAll("input,select,textarea")) assert.ok(control.matches(":disabled"), `${kind}: ${control.tagName} belum dikunci`);
        assert.ok(dialog.querySelector('button[aria-label="Tutup"]').disabled);
        document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await delay(20); assert.ok(host.querySelector('[role="dialog"]'));
        hold.release(); await waitFor(() => !host.querySelector('[role="dialog"]')); fetchWith(originalFetch);
      }
    });
    await check("submit ganda pada form ODP dan user hanya mengirim satu permintaan", async () => {
      for (const kind of ["odp", "users"]) {
        const hold = gate(); let posts = 0;
        fetchWith(async (u, o) => {
          if (urlOf(u).pathname === `/api/${kind === "odp" ? "odps" : "users"}` && o?.method === "POST") { posts++; await hold.promise; }
          return originalFetch(u, o);
        });
        await mount(`/${kind}`); await waitFor(() => button(kind === "odp" ? "Tambah ODP" : "Tambah User"));
        click(button(kind === "odp" ? "Tambah ODP" : "Tambah User")); await waitFor(() => host.querySelector(".modal-overlay form"));
        if (kind === "odp") { await change(field("Nama ODP"), "ODP-KLIK-GANDA-AUDIT"); await change(field("Induk ODC"), B.d.id); }
        else { await change(field("Email"), "klik-ganda-audit@test.local"); await change(field("Password"), "Audit123!"); await change(field("Nama Lengkap"), "User klik ganda"); }
        submit(); submit(); await delay(50); assert.equal(posts, 1); assert.ok(button("Menyimpan…")?.disabled);
        hold.release(); await waitFor(() => !host.querySelector(".modal-overlay")); fetchWith(originalFetch);
      }
      assert.equal((await request("GET", "/api/odps")).filter(p => p.name === "ODP-KLIK-GANDA-AUDIT").length, 1);
    });
    await check("dialog mengunci fokus keyboard, Escape menutup, dan fokus kembali ke pemicu", async () => {
      await mount(`/odc?odc=${B.d.id}`); await waitFor(() => core(4) && !core(4).disabled);
      const trigger = core(4); trigger.focus(); click(trigger); await waitFor(() => host.querySelector('[role="dialog"]'));
      const dialog = host.querySelector('[role="dialog"]'); assert.equal(dialog.getAttribute("aria-modal"), "true");
      const nodes = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];
      nodes.at(-1).focus(); document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
      assert.equal(document.activeElement, nodes[0]);
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await waitFor(() => !host.querySelector(".modal-overlay")); assert.equal(document.activeElement, trigger);
    });
    await check("PDF Rekap mencatat filter segmen/status aktif, bukan pencarian tab lain", async () => {
      const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL; let blob;
      URL.createObjectURL = value => { blob = value; return "blob:audit-pdf"; }; URL.revokeObjectURL = () => {};
      try {
        await mount("/laporan"); await waitFor(() => button("Alur Core ODC") && !button("Muat ulang").disabled);
        click(button("Alur Core ODC")); await waitFor(() => host.querySelector('input[placeholder^="Cari ODC"]'));
        await change(host.querySelector('input[placeholder^="Cari ODC"]'), "CARI-USANG-AUDIT");
        click(button("Rekap Core")); await waitFor(() => field("Segmen")); await change(field("Segmen"), "olt_to_odc"); await change(field("Status"), "reserved");
        assert.ok(!button("Lihat PDF").disabled); click(button("Lihat PDF")); await waitFor(() => blob && host.querySelector('[role="dialog"] a[download]'));
        const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
        const pdf = await task.promise;
        try {
          const page = await pdf.getPage(1), contents = await page.getTextContent(), pdfText = contents.items.map(i => i.str).join(" ");
          assert.match(pdfText, /Segmen: OLT\s*->\s*ODC/); assert.match(pdfText, /Status: Reserved/); assert.ok(!pdfText.includes("CARI-USANG-AUDIT"));
        } finally { await task.destroy(); }
      } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
    });
    await check("ringkasan Mapping tidak mencampur tujuan dua receiver dengan nomor core sama", async () => {
      const createOdc = name => request("POST", "/api/odcs", { name, olt_id: H1.olt.id, cable_type: "figure8_6_core" });
      const parent = await createOdc("ODC-AUDIT-RINGKAS-INDUK"), child = await createOdc("ODC-AUDIT-RINGKAS-ANAK");
      const createSp = (d, name) => request("POST", "/api/splitters", { name, odc_id: d.id, ratio: "1:4", input_core: 1 });
      const source = await createSp(parent, "SPL-AUDIT-RINGKAS-INDUK"), destinations = [];
      for (let i = 0; i < 2; i++) {
        const receiver = await createSp(child, `RECEIVER-AUDIT-${i + 1}`);
        const odp = await request("POST", "/api/odps", { name: `ODP-RECEIVER-AUDIT-${i + 1}`, odc_id: child.id, cable_type: "figure8_6_core" });
        await request("PATCH", `/api/splitter-outputs/${receiver.outputs[0].id}`, { target_type: "odp", target_id: odp.id });
        await request("PATCH", `/api/splitter-outputs/${source.outputs[i].id}`, { target_type: "odc", target_id: child.id, target_odc_splitter_id: receiver.id });
        destinations.push({ receiver, odp });
      }
      await mount(`/mapping?odc=${child.id}`);
      await waitFor(() => [...host.querySelectorAll("h2")].find(h => h.textContent === `Core Feeder OLT → ${child.name}`));
      const card = [...host.querySelectorAll("h2")].find(h => h.textContent === `Core Feeder OLT → ${child.name}`).closest(".card");
      const paths = [...card.querySelector("tbody tr td:last-child").children]; assert.equal(paths.length, 2);
      for (let i = 0; i < 2; i++) {
        const own = destinations[i], other = destinations[1 - i], path = paths.find(el => el.textContent.includes(own.receiver.name));
        assert.ok(path?.textContent.includes(own.odp.name)); assert.ok(!path.textContent.includes(other.odp.name));
      }
    });
    await check("dua notifikasi dari komponen berbeda memiliki timer independen", async () => {
      await mount("/", <ToastHarness />); await waitFor(() => button("Toast A")); click(button("Toast A")); await delay(50); click(button("Toast B"));
      await waitFor(() => text().includes("Pesan-A") && text().includes("Pesan-B")); await delay(3100);
      assert.ok(!text().includes("Pesan-A") && !text().includes("Pesan-B"));
    });
    const bad = errors.filter(e => /Each child|same key|uncontrolled|is not defined|Cannot read|not a function|order of Hooks|Objects are not valid/.test(e));
    assert.deepEqual(bad, [], errors.join("\n"));
    console.log(`\nAUDIT UI: ${passed} lulus, ${failed} gagal\n`); if (failed) throw Error(`${failed} skenario audit UI gagal`);
  } finally {
    for (const release of releases) release(); fetchWith(originalFetch); root?.unmount(); host?.remove(); console.error = originalError; window.removeEventListener("error", catchError);
  }
}
