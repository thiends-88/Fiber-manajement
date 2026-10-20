import assert from "node:assert/strict";

// Memakai harness UI + API nyata yang sama dengan alur pencatatan interface.
// Seluruh fixture hanya dibuat pada database sementara milik runner uji.
export async function runReportUI({ request, mount, getHost, button, click, fill, waitFor, olt, firstPort, newPort, directOdp }) {
  const twinOlt = await request("POST", "/api/olts", { name: "OLT-C320-LAPORAN-UI", olt_type: "ZTE C320" });
  const card = await request("POST", "/api/cards", { olt_id: twinOlt.id, shelf: 1, slot: 1, card_type: "GTGO", port_count: 8 });
  const twinPort = await request("POST", "/api/ports", { card_id: card.id, port: 1, status: "active" });
  const emptyPort = await request("POST", "/api/ports", { card_id: card.id, port: 2, status: "reserved" });
  const twinOdc = await request("POST", "/api/odcs", { name: "ODC-LAPORAN-UI", olt_id: twinOlt.id, cable_type: "24_core_4_tube", feeder_port_ids: [twinPort.id, emptyPort.id] });
  const twinOdp = await request("POST", "/api/odps", { name: "ODP-UI-OLT-LAIN", odc_id: twinOdc.id, cable_type: "12_core_2_tube", location: "Lokasi khusus OLT lain" });
  const unknownOdp = await request("POST", "/api/odps", { name: "ODP-UI-TANPA-MAPPING", odc_id: twinOdc.id, cable_type: "12_core_2_tube" });
  await request("POST", "/api/links", { odc_id: twinOdc.id, odc_core: 1, odp_id: twinOdp.id, odp_core: 1 });
  await request("POST", "/api/links", { odc_id: twinOdc.id, odc_core: 2, odp_id: unknownOdp.id, odp_core: 1 });
  await request("PUT", "/api/interface-mappings", { odc_id: twinOdc.id, core: 1, port_id: twinPort.id, notes: "Jalur OLT kedua" });
  const snapshot = async () => JSON.stringify(await Promise.all(["olts", "ports", "odcs", "odps", "links", "feeder-ports", "splitters", "cores", "interface-mappings"].map((p) => request("GET", `/api/${p}`))));
  const before = await snapshot();
  const panel = () => getHost().querySelector("#laporan-hasil");
  const groups = () => [...getHost().querySelectorAll("[data-report-group]")];
  const selectOlt = () => getHost().querySelector('[aria-label="OLT laporan interface"]');
  const selectPort = () => getHost().querySelector('[aria-label="Interface laporan"]');
  const search = () => getHost().querySelector('input[placeholder="Cari interface, ODC, ODP, core, lokasi…"]');
  const count = (key) => Number(getHost().querySelector(`[data-report-stat="${key}"]`)?.textContent);
  const hostText = () => getHost().textContent;
  await mount("/laporan");
  await waitFor(() => groups().length > 0, "Laporan interface belum dimuat");
  assert.equal(button("Per Interface").getAttribute("aria-selected"), "true");
  await fill(selectOlt(), olt.id); await fill(selectPort(), newPort.id);
  await waitFor(() => groups().length === 1 && panel().textContent.includes(directOdp.name), "Laporan port kabel langsung belum tersedia");
  assert.equal(groups()[0].open, true); assert.equal(count("interfaces"), 1); assert.equal(count("odps"), 1);
  assert.ok(panel().textContent.includes("GPON 1/1/4") && panel().textContent.includes("C4 → C1"));
  assert.ok(!panel().textContent.includes("SPL-1") && !panel().textContent.includes("ODP-004"));
  assert.ok(!button("CSV").disabled && !button("Lihat PDF").disabled && !button("Unduh PDF").disabled);
  const routeLink = groups()[0].querySelector('a[href^="/?olt="]');
  assert.equal(routeLink.getAttribute("href"), `/?olt=${olt.id}&interface=${newPort.id}`);
  console.log("  OK    Laporan → filter OLT/interface → rincian kabel langsung, ringkasan unik dan tautan jalur");

  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const anchorProto = window.HTMLAnchorElement.prototype, originalClick = anchorProto.click;
  const blobs = new Map(), downloads = [];
  URL.createObjectURL = (blob) => { const url = `blob:laporan-uji-${blobs.size}`; blobs.set(url, blob); return url; };
  URL.revokeObjectURL = () => {};
  anchorProto.click = function () { if (this.download) downloads.push({ name: this.download, url: this.href }); else originalClick.call(this); };
  try {
    click(button("CSV"));
    await waitFor(() => downloads.length === 1, "CSV belum diunduh");
    let csv = await blobs.get(downloads[0].url).text();
    assert.match(downloads[0].name, /laporan-interface-OLT-PST-01-GPON-1-1-4-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.ok(csv.includes(directOdp.name) && csv.includes("gpon-olt_1/1/4") && csv.includes("ODF tray 4, kabel A"));
    assert.ok(!csv.includes("ODP-004") && !csv.includes("SPL-1"));
    assert.equal(csv.split("\r\n").length - 1, groups()[0].querySelectorAll("tbody tr").length);

    await fill(selectPort(), firstPort.id);
    await waitFor(() => panel().textContent.includes("ODP-004"), "Laporan belum menampilkan ODC anak");
    assert.ok(!panel().textContent.includes(directOdp.name));
    const beforeSearch = count("odps");
    await fill(search(), "ODP-004");
    assert.equal(count("odps"), beforeSearch, "Pencarian memilih interface, tidak memotong cabangnya");
    assert.ok(panel().textContent.includes("ODP-001") && panel().textContent.includes("ODP-004"));
    click(button("CSV"));
    await waitFor(() => downloads.length === 2, "CSV hasil pencarian belum diunduh");
    csv = await blobs.get(downloads[1].url).text();
    assert.ok(csv.includes("ODP-001") && csv.includes("ODP-004") && csv.includes("SPL-3"));
    assert.ok(!csv.includes(directOdp.name) && !csv.includes(unknownOdp.name));
    assert.equal(csv.split("\r\n").length - 1, groups()[0].querySelectorAll("tbody tr").length);
    console.log("  OK    pencarian ODP anak mempertahankan seluruh cabang interface; isi CSV sama dengan rincian terfilter");

    // jsdom tidak menyediakan browser worker/canvas untuk viewer. Periksa alur
    // pembentukan PDF + modal + file; isi/multi-halaman dibaca ulang oleh uji PDF.
    click(button("Lihat PDF"));
    await waitFor(() => getHost().querySelector('[role="dialog"]'), "Modal PDF belum tersedia");
    const download = getHost().querySelector('[role="dialog"] a[download]');
    assert.match(download.download, /OLT-PST-01-GPON-1-1-1-.*\.pdf$/);
    const blob = blobs.get(download.href);
    assert.ok(blob && blob.type === "application/pdf");
    const bytes = await blob.arrayBuffer();
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => !getHost().querySelector('[role="dialog"]'), "Escape belum menutup pratinjau");
    console.log("  OK    Lihat PDF membentuk berkas PDF terfilter, nama interface, tautan unduh dan modal yang dapat ditutup");
  } finally {
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; anchorProto.click = originalClick;
  }

  for (const [label, expected] of [["Alur Core ODC", directOdp.name], ["Power ODP", "Core power ODP"], ["Rekap Core", "Segmen"]]) {
    click(button(label));
    await waitFor(() => panel().textContent.includes(expected), `Laporan lama ${label} tidak tersedia`);
    assert.ok(!button("CSV").disabled);
    if (label === "Alur Core ODC") {
      const direct = [...panel().querySelectorAll("tbody tr")].find((r) => r.textContent.includes(directOdp.name));
      assert.ok(direct.textContent.includes("GPON 1/1/4"));
      assert.ok(!direct.textContent.includes("GPON 1/1/1"), "Daftar feeder tidak dijadikan sumber semua core");
    }
  }
  click(button("Per Interface"));
  await waitFor(() => selectOlt() && groups().length === 1, "Tab interface belum kembali");
  assert.equal(search().value, "ODP-004");
  await fill(search(), ""); await fill(selectOlt(), twinOlt.id);
  assert.equal(selectPort().value, "all", "Mengubah OLT mereset filter port lama");
  assert.ok([...selectPort().options].filter((o) => !["all", "unmapped"].includes(o.value)).every((o) => o.textContent.includes(twinOlt.name)));
  await fill(selectPort(), twinPort.id);
  assert.equal(count("interfaces"), 1); assert.equal(count("odps"), 1);
  assert.ok(panel().textContent.includes(twinOdp.name) && panel().textContent.includes("GPON 1/1/1"));
  assert.ok(!panel().textContent.includes("ODP-004") && !panel().textContent.includes(unknownOdp.name));
  await fill(selectPort(), "unmapped");
  assert.equal(count("interfaces"), 0); assert.equal(count("unmapped"), 1);
  assert.ok(panel().textContent.includes(unknownOdp.name) && panel().textContent.includes("bukan konfirmasi asal interface"));
  assert.ok(!panel().textContent.includes(twinOdp.name));
  await fill(selectPort(), emptyPort.id);
  assert.equal(count("odps"), 0); assert.equal(count("odcs"), 0);
  assert.ok(panel().textContent.includes("Belum ada mapping interface ke core feeder"));
  assert.ok(!panel().textContent.includes(unknownOdp.name));
  await fill(search(), "tidak-ada-hasil-ui");
  assert.ok(button("CSV").disabled && button("Lihat PDF").disabled && button("Unduh PDF").disabled);
  assert.ok(panel().textContent.includes("Tidak ada hasil sesuai filter"));
  await fill(search(), "");
  console.log("  OK    tiga laporan lama tetap tersedia; OLT dengan label kembar, jalur belum dipetakan, port kosong dan hasil kosong tetap terpisah");

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (url, options) => new URL(String(url), window.location.href).pathname === "/api/interface-mappings"
      ? Promise.resolve(new Response(JSON.stringify({ error: "Gangguan jaringan uji laporan" }), { status: 503, headers: { "content-type": "application/json" } })) : originalFetch(url, options);
    click(button("Muat ulang"));
    await waitFor(() => hostText().includes("Gangguan jaringan uji laporan"), "Kegagalan data mapping belum ditampilkan");
    assert.ok(button("CSV").disabled && button("Lihat PDF").disabled && button("Unduh PDF").disabled);
    assert.equal(groups().length, 0, "Hasil lama tidak ditampilkan sebagai hasil terbaru setelah gagal muat");
  } finally { globalThis.fetch = originalFetch; }
  click(button("Muat ulang"));
  await waitFor(() => groups().length === 1 && !button("CSV").disabled, "Muat ulang belum memulihkan laporan");
  assert.equal(await snapshot(), before, "Membaca, memfilter, memuat ulang dan mengekspor laporan tidak mengubah data jaringan");

  // Simulasikan port dihapus dari sesi lain, bukan melalui laporan.
  await request("DELETE", `/api/ports/${emptyPort.id}`);
  click(button("Muat ulang"));
  await waitFor(() => hostText().includes("Pilihan OLT/interface sudah tidak tersedia"), "Filter usang tidak diberi penjelasan");
  assert.ok(button("CSV").disabled && selectPort().selectedOptions[0].textContent.includes("tidak tersedia"));
  click(button("Reset filter"));
  await waitFor(() => groups().length > 1 && !button("CSV").disabled, "Reset filter tidak memulihkan pilihan yang tersedia");
  console.log("  OK    gagal muat mengunci ekspor, muat ulang memulihkan laporan, filter usang dijelaskan, dan seluruh aksi laporan tidak mengubah data");
}
