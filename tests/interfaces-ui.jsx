// Interaksi UI React dengan API SQLite sungguhan di database uji terpisah.
import assert from "node:assert/strict";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { AuthProvider } from "../src/lib/auth.jsx";
import { setMemToken } from "../src/lib/api.js";
import { runReportUI } from "./interface-report-ui.mjs";

export async function run({ request, odc, olt, firstPort, directOdp, reader }) {
  let root, host;
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  const text = () => host.textContent;
  const delay = (n) => new Promise((r) => setTimeout(r, n));
  async function waitFor(check, message) {
    const start = Date.now();
    while (Date.now() - start < 6000) {
      if (check()) return;
      await delay(20);
    }
    throw new Error(`${message}; tampilan: ${text().slice(-1200)}`);
  }
  async function mount(route) {
    root?.unmount(); host?.remove();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    root.render(<MemoryRouter initialEntries={[route]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
    await waitFor(() => host.querySelector("h1"), `Rute ${route} belum tampil`);
  }
  const button = (name) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
  function click(element) { assert.ok(element, "Elemen yang akan diklik tersedia"); element.click(); }
  function change(element, value) {
    assert.ok(element, "Field tersedia");
    const win = element.ownerDocument.defaultView;
    const proto = element.tagName === "SELECT" ? win.HTMLSelectElement.prototype : element.tagName === "TEXTAREA" ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(element, String(value));
    element.dispatchEvent(new win.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  }
  function field(name, context = host) {
    const label = [...context.querySelectorAll("label")].find((l) => l.textContent.trim() === name || l.textContent.trim().startsWith(name));
    return label?.parentElement.querySelector("input, select, textarea");
  }
  async function fill(element, value) { change(element, value); await delay(20); }
  function submit() { const form = host.querySelector(".modal-overlay form"); assert.ok(form); form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); }
  const modalClosed = () => !host.querySelector(".modal-overlay");
  try {
    await mount(`/olt?olt=${olt.id}`);
    await waitFor(() => host.querySelector('button[title^="GPON 1/1/4:"]'), "Grid interface ZTE belum muncul");
    click(host.querySelector('button[title^="GPON 1/1/4:"]'));
    await waitFor(() => text().includes("gpon-olt_1/1/4"), "Preview CLI interface belum muncul");
    await fill(host.querySelector('[aria-label="Status tercatat"]'), "active");
    submit();
    await waitFor(() => modalClosed() && [...host.querySelectorAll("a")].some((a) => a.textContent === "GPON 1/1/4"), "Pencatatan port ZTE gagal");
    const newPort = (await request("GET", `/api/ports?olt_id=${olt.id}`)).find((p) => p.port === 4 && p.slot === 1);
    assert.ok(newPort && newPort.status === "active");
    console.log("  OK    klik port ZTE → preview 1/1/4 → simpan interface → tautan jalur tersedia");

    click(button("Tambah OLT"));
    await waitFor(() => host.querySelector(".modal-overlay"), "Form OLT belum terbuka");
    await fill(field("Nama OLT"), "OLT-HSGQ-UJI-UI");
    await fill(field("Tipe OLT"), "HSGQ XPON");
    assert.equal(host.querySelector('[aria-label="Format interface"]').value, "pon");
    await fill(host.querySelector('[aria-label="Jumlah port PON bawaan"]'), "4");
    submit();
    await waitFor(() => modalClosed() && text().includes("Port bawaan OLT") && host.querySelector('button[title^="PON 1:"]'), "Port HSGQ belum tersedia");
    assert.ok(!button("Tambah Card"), "OLT fixed-port tidak meminta card");
    click(host.querySelector('button[title^="PON 1:"]'));
    await waitFor(() => host.querySelector(".modal-overlay form"), "Form PON belum tersedia");
    submit();
    await waitFor(() => modalClosed() && [...host.querySelectorAll("a")].some((a) => a.textContent === "PON 1"), "Port HSGQ gagal disimpan");
    console.log("  OK    pilih HSGQ → format PON otomatis → catat port tanpa membuat card");

    await mount(`/odc?odc=${odc.id}`);
    await waitFor(() => host.querySelector(`button[title="Edit ODC ${odc.name}"]`), "Daftar ODC belum tersedia");
    click(host.querySelector(`button[title="Edit ODC ${odc.name}"]`));
    await waitFor(() => host.querySelector(".modal-overlay"), "Edit ODC belum terbuka");
    const label = [...host.querySelectorAll(".modal-overlay label")].find((l) => l.textContent.includes("GPON 1/1/4"));
    click(label?.querySelector('input[type="checkbox"]'));
    submit();
    await waitFor(() => modalClosed() && text().includes("ODC tersimpan") && button("Petakan interface"), "Perubahan feeder ODC belum tersimpan");
    click(button("Petakan interface"));
    await waitFor(() => host.querySelector('[aria-label="Interface sumber dari OLT"] option[value="' + newPort.id + '"]'), "Pilihan feeder baru belum diperbarui setelah Edit ODC");
    await fill(host.querySelector('[aria-label="Core kabel feeder ODC"]'), "4");
    await fill(host.querySelector('[aria-label="Interface sumber dari OLT"]'), newPort.id);
    await fill(field("Catatan sambungan lapangan"), "ODF tray 4, kabel A");
    submit();
    await waitFor(() => modalClosed() && text().includes("ODF tray 4, kabel A"), "Mapping interface gagal tersimpan");
    let mapping = (await request("GET", `/api/interface-mappings?odc_id=${odc.id}`)).find((m) => m.core === 4);
    assert.equal(mapping.port_id, newPort.id);
    console.log("  OK    Edit ODC → pilih feeder baru → petakan interface ke core dan catatan lapangan");

    await mount(`/mapping?odc=${odc.id}`);
    await waitFor(() => button("Tambah Sambungan"), "Mapping Core belum tampil");
    click(button("Tambah Sambungan"));
    await waitFor(() => host.querySelector(".modal-overlay form"), "Form sambungan belum tersedia");
    const form = host.querySelector(".modal-overlay form");
    await fill(field("Core ODC", form), "4");
    await fill(field("ODP", form), directOdp.id);
    await fill(field("Core ODP", form), "1");
    submit();
    await waitFor(() => modalClosed() && text().includes(directOdp.name), "Sambungan core ke ODP belum tampil");
    assert.ok((await request("GET", `/api/links?odc_id=${odc.id}`)).some((l) => l.odp_id === directOdp.id && l.odc_core === 4));

    await mount(`/?olt=${olt.id}&interface=${newPort.id}`);
    await waitFor(() => text().includes(directOdp.name), "Filter interface belum menampilkan ODP tujuan");
    assert.ok(!text().includes("SPL-1")); assert.ok(!text().includes("ODP-004"));
    assert.ok(text().includes("Sambungan Kabel Langsung"));
    change(host.querySelector('[aria-label="Interface sumber"]'), firstPort.id);
    await waitFor(() => text().includes("SPL-1") && text().includes("ODP-004"), "Cabang ODC anak belum mengikuti interface sumber");
    assert.ok(!text().includes(directOdp.name));
    click(button("Diagram"));
    await waitFor(() => host.querySelector("svg text") && [...host.querySelectorAll("svg text")].some((t) => t.textContent === "ODP-004"), "Diagram belum menampilkan jalur anak");
    const odpText = [...host.querySelectorAll("svg text")].find((t) => t.textContent === "ODP-004");
    odpText.parentElement.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => text().includes("Alur core sampai ke sini") && text().includes("Sumber jalur:"), "Rincian hulu diagram belum tampil");
    assert.ok(text().includes("GPON 1/1/1"));
    console.log("  OK    filter interface, kabel langsung, ODC anak, diagram dan rincian sumber tidak tertukar");

    await mount("/odp");
    await waitFor(() => [...host.querySelectorAll("tbody tr")].some((r) => r.textContent.includes(directOdp.name)), "ODP tujuan belum tampil");
    click([...host.querySelectorAll("tbody tr")].find((r) => r.textContent.includes(directOdp.name)));
    await waitFor(() => text().includes("Asal interface OLT") && text().includes("GPON 1/1/4"), "Asal interface pada ODP belum muncul");
    assert.ok(text().includes("C4 → C1"));
    console.log("  OK    detail ODP menelusuri kembali ke interface dan core asal yang tepat");

    await runReportUI({ request, mount, getHost: () => host, button, click, fill, waitFor, olt, firstPort, newPort, directOdp });

    await mount(`/mapping?odc=${odc.id}`);
    await waitFor(() => host.querySelector('button[title="Lepaskan mapping core 4"]'), "Mapping yang akan dilepas belum tampil");
    click(host.querySelector('button[title="Lepaskan mapping core 4"]'));
    await waitFor(() => text().includes("Mapping dilepas; sambungan hilir tetap dipertahankan"), "Mapping belum dilepas");
    assert.ok((await request("GET", `/api/links?odc_id=${odc.id}`)).some((l) => l.odp_id === directOdp.id));
    await mount(`/?olt=${olt.id}&interface=unmapped`);
    await waitFor(() => text().includes(directOdp.name), "Jalur tanpa mapping hilang dari filter belum dipetakan");
    assert.ok(text().includes("Interface asal belum dipetakan"));
    console.log("  OK    lepas mapping mempertahankan hilir dan menandai sumber belum dipetakan");

    setMemToken(null);
    localStorage.setItem("fiberops_arena_token", reader.token);
    localStorage.setItem("fiberops_arena_user", JSON.stringify(reader.user));
    await mount(`/mapping?odc=${odc.id}`);
    await waitFor(() => text().includes("Interface OLT → Core Feeder"), "Halaman baca belum tampil");
    assert.ok(!button("Petakan interface") && !button("Tambah Sambungan"));
    assert.ok(!host.querySelector('button[title="Lepaskan mapping core 1"]'));
    await mount("/laporan");
    await waitFor(() => host.querySelector("[data-report-group]"), "Laporan untuk peran baca belum tersedia");
    await fill(host.querySelector('[aria-label="OLT laporan interface"]'), olt.id);
    await fill(host.querySelector('[aria-label="Interface laporan"]'), "unmapped");
    assert.ok(host.querySelector("#laporan-hasil").textContent.includes(directOdp.name));
    assert.ok(!button("CSV").disabled && !button("Lihat PDF").disabled);
    assert.ok(!button("Petakan interface") && !button("Tambah Sambungan"));
    console.log("  OK    peran baca saja dapat melihat jalur/laporan dan mengekspor tanpa kontrol perubahan");
    assert.ok(!errors.some((e) => /Each child|same key|uncontrolled|is not defined|Cannot read|not a function|change in the order of Hooks|Objects are not valid/.test(e)), errors.join("\n"));
    console.log("\nINTERFACE UI: seluruh skenario interaksi lulus");
  } finally {
    root?.unmount(); host?.remove(); console.error = originalError;
  }
}
