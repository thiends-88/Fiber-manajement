import assert from "node:assert/strict";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildInterfaceReport, filterInterfaceReport, interfaceReportExport, summarizeInterfaceReport } from "../src/lib/interface-report.js";
import { createInterfaceReportPdf, pdfReportText } from "../src/lib/interface-report-pdf.js";
import { csvContent, reportDate } from "../src/lib/report-csv.js";
import { reportNetwork } from "./fixtures/interface-report-network.mjs";

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  OK    ${name}`); }
  catch (e) { console.error(`  GAGAL ${name}`); throw e; }
}
const input = reportNetwork();
const report = buildInterfaceReport(input);
const selected = (id, data = report) => filterInterfaceReport(data.items, { portId: id });
const destinationIds = (items) => [...new Set(items.flatMap((i) => i.rows.filter((r) => r.odpId != null).map((r) => r.odpId)))].sort((a, b) => a - b);
const outputText = (items) => interfaceReportExport(items).rows.flat().join("\n");
const pdfOptions = { filterDescription: "OLT-C300 / GPON 1/1/1 / Pencarian: Ujung Solok", generatedAt: new Date("2026-10-19T08:30:00+07:00") };
async function pdfPages(doc) {
  const loadingTask = getDocument({ data: new Uint8Array(doc.output("arraybuffer")), useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const pages = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { items } = await page.getTextContent();
      pages.push({ text: items.map((i) => i.str).join(" "), tokens: items, height: page.view[3], width: page.view[2] });
    }
  } finally { await loadingTask.destroy(); }
  return pages;
}

console.log("\n=== UJI LAPORAN PER INTERFACE ===");
await check("interface yang berbagi ODC tetap memiliki tujuan yang terpisah", () => {
  assert.deepEqual(destinationIds(selected(11)), [1, 3]);
  assert.deepEqual(destinationIds(selected(12)), [2, 4]);
  assert.ok(!outputText(selected(11)).includes("ODP-B"));
  assert.ok(!outputText(selected(11)).includes("SPL-ANAK-B"));
  assert.ok(!outputText(selected(12)).includes("SPL-ANAK-A"));
});
await check("cascade, output, receiver ODC anak dan lokasi tercatat lengkap", () => {
  const row = selected(11)[0].rows.find((r) => r.odpId === 3);
  assert.match(row.path, /OLT-C300.*GPON 1\/1\/1.*ODC-PUSAT.*SPL-A \(1:4\).*out 1.*SPL-A2.*out 2.*ODC-ANAK.*SPL-ANAK-A.*out 1.*ODP-C/);
  assert.equal(row.location, "Ujung Solok");
  assert.equal(row.notes, "ODF tray 1 / kabel A");
  assert.equal(selected(11)[0].odcIds.size, 2);
});
await check("nomor 1/1/1 pada dua OLT dipilih menurut ID, bukan label", () => {
  assert.equal(selected(11)[0].port.interface_label, selected(21)[0].port.interface_label);
  assert.deepEqual(destinationIds(selected(21)), [6]);
  assert.deepEqual(filterInterfaceReport(report.items, { oltId: "2" }).map((i) => i.port.id), [21]);
  assert.deepEqual(filterInterfaceReport(report.items, { oltId: "2", portId: "11" }), []);
  assert.ok(!outputText(selected(21)).includes("ODP-C"));
});
await check("kabel langsung mempertahankan core warna/tube feeder dan core masuk ODP", () => {
  const item = selected(13)[0], row = item.rows[0];
  assert.deepEqual(destinationIds([item]), [5]);
  assert.match(row.path, /kabel langsung C7 → C2.*ODP-LANGSUNG/);
  assert.equal(row.color, "Biru"); assert.equal(row.tube, 2);
  assert.match(row.notes, /Sambungan tray 7/);
  assert.equal(item.status, "Non-aktif", "Catatan status tidak menghapus dokumentasi sambungan");
});
await check("output belum diarahkan dan feeder tanpa hilir tidak hilang dari laporan", () => {
  assert.ok(selected(11)[0].rows.some((r) => r.target === "3 output belum diarahkan" && r.odpId == null));
  const item = selected(14)[0];
  assert.equal(item.odcIds.size, 1); assert.equal(item.odpIds.size, 0);
  assert.match(item.rows[0].condition, /Core feeder sudah dipetakan; sambungan hilir belum dicatat/);
  assert.match(item.rows[0].notes, /Disiapkan/);
});
await check("interface yang belum dipetakan tetap tampil tanpa mengarang ODC/ODP", () => {
  const item = selected(15)[0];
  assert.equal(item.groups.length, 0); assert.equal(item.odcIds.size, 0); assert.equal(item.odpIds.size, 0);
  assert.match(item.rows[0].condition, /Belum ada mapping interface/);
  assert.equal(item.rows[0].core, null); assert.equal(item.rows[0].color, ""); assert.equal(item.rows[0].tube, null);
});
await check("PON fixed-port dan nama interface manual tidak dibuatkan CLI ZTE", () => {
  const hsgq = selected(31)[0];
  assert.equal(hsgq.port.interface_label, "PON 1"); assert.equal(hsgq.port.interface_cli, "");
  const manual = reportNetwork(); manual.olts[2].interface_mode = "custom"; manual.ports.at(-1).interface_name = "EPON0/1";
  const item = selected(31, buildInterfaceReport(manual))[0];
  assert.equal(item.port.interface_label, "EPON0/1"); assert.equal(item.port.interface_cli, "EPON0/1");
});
await check("sumber tanpa mapping tetap terpisah meskipun ODC sudah memiliki feeder", () => {
  const items = filterInterfaceReport(report.items, { portId: "unmapped" });
  assert.equal(items.length, 1); assert.deepEqual(destinationIds(items), [8]);
  assert.ok(items.every((i) => i.port === null));
  assert.match(outputText(items), /Interface asal belum dipetakan/);
  const noMaps = buildInterfaceReport({ ...input, interfaceMappings: [] });
  assert.ok(noMaps.items.filter((i) => i.port).every((i) => i.odpIds.size === 0));
});
await check("input ganda membatalkan klaim sumber dan memberi peringatan pada port tercatat", () => {
  const broken = reportNetwork(); broken.links.push({ id: 90, odc_id: 1, odc_core: 1, odp_id: 8, odp_core: 3 });
  const result = buildInterfaceReport(broken), port = selected(11, result)[0];
  assert.equal(port.odpIds.size, 0); assert.equal(port.groups.length, 0);
  assert.match(port.issues.join(" "), /Input core ganda/);
  const unknown = filterInterfaceReport(result.items, { portId: "unmapped" });
  assert.ok(unknown.some((i) => /Input core ganda/.test(i.reason) && i.odpIds.has(3)));
  assert.ok(!outputText([port]).includes("ODP-C"));
});
await check("mapping rusak, port dihapus, feeder dilepas, atau OLT salah tidak menjadi sumber", () => {
  for (const change of [
    (d) => { d.ports = d.ports.filter((p) => p.id !== 11); },
    (d) => { d.feederPorts = d.feederPorts.filter((p) => p.port_id !== 11); },
    (d) => { d.interfaceMappings[0].port_id = 21; },
  ]) {
    const broken = reportNetwork(); change(broken);
    const result = buildInterfaceReport(broken);
    assert.ok(!result.items.some((i) => i.port && i.odpIds.has(3)));
    assert.ok(result.items.some((i) => i.unmapped && i.odpIds.has(3) && /perlu diperiksa/.test(i.reason)));
  }
});
await check("core input kosong tidak diberi warna/tube fiktif", () => {
  const broken = reportNetwork(); broken.splitters[0].input_core = null;
  const result = buildInterfaceReport(broken), item = result.items.find((i) => i.unmapped && i.odpIds.has(3));
  assert.ok(item); assert.match(item.reason, /belum diisi/);
  assert.ok(item.rows.every((r) => r.core == null && !r.color && r.tube == null));
  assert.ok(interfaceReportExport([item]).rows.every((r) => r[5] === "" && r[6] === "" && r[7] === ""));
});
await check("receiver ODC belum dipilih tidak mengambil semua splitter pada kabinet tujuan", () => {
  const broken = reportNetwork(); delete broken.splitters[1].outputs[1].target_odc_splitter_id;
  broken.splitters[1].outputs[1].target_odc_core = 1;
  const item = selected(11, buildInterfaceReport(broken))[0];
  assert.deepEqual(destinationIds([item]), [1]);
  assert.ok(item.rows.some((r) => r.target === "ODC-ANAK" && r.condition === "Splitter penerima ODC belum dipilih"));
});
await check("dua core masuk ODP bersama hanya meneruskan sumber ke splitter internal yang cocok", () => {
  const inside = reportNetwork();
  inside.odps = [
    { id: 100, odc_id: 1, name: "ODP-BERSAMA", cable_type: "12_core_2_tube" },
    { id: 201, odc_id: 1, name: "ODP-HILIR-A", cable_type: "12_core_2_tube" },
    { id: 202, odc_id: 1, name: "ODP-HILIR-B", cable_type: "12_core_2_tube" },
  ];
  inside.links = [{ id: 1, odc_id: 1, odc_core: 1, odp_id: 100, odp_core: 1 }, { id: 2, odc_id: 1, odc_core: 2, odp_id: 100, odp_core: 2 }];
  inside.splitters = [
    { id: 101, odp_id: 100, name: "SPL-ODP-A", ratio: "1:8", input_core: 1, outputs: [{ port: 1, target_type: "odp", target_odp_id: 201 }] },
    { id: 102, odp_id: 100, name: "SPL-ODP-B", ratio: "1:8", input_core: 2, outputs: [{ port: 1, target_type: "odp", target_odp_id: 202 }] },
  ];
  const result = buildInterfaceReport(inside);
  assert.deepEqual(destinationIds(selected(11, result)), [100, 201]);
  assert.deepEqual(destinationIds(selected(12, result)), [100, 202]);
  assert.ok(!outputText(selected(11, result)).includes("SPL-ODP-B"));
  assert.equal(summarizeInterfaceReport([...selected(11, result), ...selected(12, result)]).odps, 3);
  inside.links = [];
  inside.splitters.push({ id: 103, odc_id: 1, name: "SPL-MASUK-ODP", ratio: "1:4", input_core: 1, outputs: [{ port: 1, target_type: "odp", target_odp_id: 100 }] });
  const unknownCore = selected(11, buildInterfaceReport(inside));
  assert.deepEqual(destinationIds(unknownCore), [100], "Output splitter tidak menyimpan core masuk ODP, jangan terka seluruh isi ODP");
  assert.ok(!outputText(unknownCore).includes("SPL-ODP-A"));
});
await check("jalur legacy yang berputar berhenti dengan peringatan tanpa mencampur receiver lain", () => {
  const cycle = reportNetwork();
  cycle.splitters[3].outputs.push({ port: 2, target_type: "odc", target_odc_id: 2, target_odc_splitter_id: 5 });
  const item = selected(11, buildInterfaceReport(cycle))[0];
  assert.ok(item.rows.length < 30); assert.ok(item.rows.some((r) => /berputar/.test(r.condition)));
  assert.deepEqual(destinationIds([item]), [1, 3]);
  assert.equal(new Set(item.rows.map((r) => r.key)).size, item.rows.length);
});
await check("ODP yang belum tersambung tidak dimasukkan sebagai tujuan satu pun interface", () => {
  assert.ok(!report.items.some((i) => i.odpIds.has(7)));
  assert.ok(report.routes.unconnectedOdps.some((o) => o.id === 7));
});
await check("statistik unik tidak menghitung ulang ODP pada beberapa output atau interface", () => {
  const shared = reportNetwork();
  shared.splitters[1].outputs.push({ port: 3, target_type: "odp", target_odp_id: 1 });
  shared.splitters[2].outputs.push({ port: 3, target_type: "odp", target_odp_id: 1 });
  const result = buildInterfaceReport(shared);
  assert.equal(selected(11, result)[0].rows.filter((r) => r.odpId === 1).length, 2);
  const both = [...selected(11, result), ...selected(12, result)];
  assert.equal(summarizeInterfaceReport(both).odps, 4); assert.equal(summarizeInterfaceReport(both).odcs, 2);
});
await check("pencarian CLI, lokasi dan catatan memilih interface beserta seluruh jalurnya", () => {
  for (const query of ["  UJUNG SOLOK  ", "gpon-olt_1/1/1", "ODF tray 1", "ODP-C"]) {
    const items = filterInterfaceReport(report.items, { oltId: "1", query });
    assert.equal(items.length, 1); assert.equal(items[0].port.id, 11);
    assert.deepEqual(destinationIds(items), [1, 3]);
  }
  assert.equal(filterInterfaceReport(report.items, { query: "Sambungan tray 7" })[0].port.id, 13);
  assert.deepEqual(filterInterfaceReport(report.items, { query: "tidak-ada-yang-cocok" }), []);
});
await check("CSV memuat hasil filter yang sama, CLI, status manual dan nama file yang jelas", () => {
  const items = filterInterfaceReport(report.items, { oltId: "1", query: "Ujung Solok" });
  const { head, rows, slug } = interfaceReportExport(items);
  assert.equal(rows.length, summarizeInterfaceReport(items).rows); assert.equal(head.length, 13);
  assert.ok(rows.every((r) => r.length === head.length && r[0] === "OLT-C300" && r[1] === "GPON 1/1/1" && r[2] === "gpon-olt_1/1/1" && r[3] === "Aktif"));
  assert.equal(slug, "laporan-interface-OLT-C300-GPON-1-1-1");
  const csv = csvContent(head, rows);
  assert.equal(csv.charCodeAt(0), 0xfeff); assert.match(csv, /ODP-C/); assert.ok(!csv.includes("ODP-OLT-LAIN"));
});
await check("CSV mengamankan formula, tanda kutip, titik koma, baris baru, angka nol dan nilai kosong", () => {
  const csv = csvContent(["Satu", 'Judul "dua"'], [[' =1+1', 'Kabel; "A"\ntray 1'], ["+SUM(A1:A2)", "@A1"], ["-cmd", "\t=1+2"], [null, 0]]);
  assert.ok(csv.startsWith('\uFEFF"Satu";"Judul ""dua"""\r\n'));
  assert.ok(csv.includes('"\' =1+1";"Kabel; ""A""\ntray 1"'));
  for (const value of ["+SUM(A1:A2)", "@A1", "-cmd", "\t=1+2"]) assert.ok(csv.includes(`"'${value}"`));
  assert.ok(csv.endsWith('"";"0"'));
  assert.equal(reportDate(new Date(2026, 9, 19, 0, 15)), "2026-10-19");
});
await check("PDF dapat dibaca kembali, tidak bocor ke interface lain, dan menyimpan filter/ringkasan", async () => {
  const doc = createInterfaceReportPdf(selected(11), pdfOptions);
  const pages = await pdfPages(doc), text = pages.map((p) => p.text).join(" ");
  assert.match(text, /Laporan Per Interface OLT/); assert.match(text, /GPON 1\/1\/1/); assert.match(text, /gpon-olt_1\/1\/1/);
  assert.match(text, /Pencarian: Ujung Solok/); assert.match(text, /2 ODP unik/); assert.match(text, /ODP-A/); assert.match(text, /ODP-C/);
  assert.match(text, /ODF tray 1/); assert.match(text, /bukan status online/);
  for (const wrong of ["ODP-B", "ODP-D", "ODP-OLT-LAIN", "SPL-ANAK-B", "GPON 1/2/1"]) assert.ok(!text.includes(wrong), wrong);
  assert.equal(pdfReportText("A → B · C — D"), "A  ->  B  /  C - D");
  assert.ok(pages.every((p) => Math.abs(p.width - 841.89) < 1 && Math.abs(p.height - 595.28) < 1));
});
await check("PDF beberapa halaman mengulang konteks interface, kolom dan nomor halaman lengkap", async () => {
  const item = selected(11)[0];
  const manyRows = Array.from({ length: 75 }, (_, i) => ({ ...item.rows[0], key: `long-${i}`, target: `ODP-PANJANG-${i + 1}`, path: `${item.rows[0].path} → jalur tambahan ${i + 1}` }));
  const pages = await pdfPages(createInterfaceReportPdf([{ ...item, rows: manyRows }], pdfOptions));
  assert.ok(pages.length > 1);
  for (let n = 0; n < pages.length; n++) {
    const { text, tokens } = pages[n];
    assert.match(text, /GPON 1\/1\/1/); assert.match(text, /gpon-olt_1\/1\/1/); assert.match(text, /Jalur lengkap/);
    assert.match(text, new RegExp(`hal\\. ${n + 1} dari ${pages.length}`));
    assert.ok(tokens.every((t) => t.transform[5] > 10 && t.transform[5] < pages[n].height - 15), "Teks tidak keluar batas halaman");
  }
  assert.ok(pages.map((p) => p.text).join(" ").includes("ODP-PANJANG-75"));
});
await check("PDF seluruh interface dan data kosong tetap valid", async () => {
  const pages = await pdfPages(createInterfaceReportPdf(report.items, { generatedAt: pdfOptions.generatedAt }));
  const text = pages.map((p) => p.text).join(" ");
  assert.match(text, /OLT-C300/); assert.match(text, /OLT-C320/); assert.match(text, /PON 1/); assert.match(text, /Belum dipetakan/);
  assert.match(text, /Belum ada mapping interface ke core feeder/); assert.match(text, /7 ODP unik/);
  const empty = buildInterfaceReport();
  assert.deepEqual(empty.items, []); assert.deepEqual(summarizeInterfaceReport([]), { interfaces: 0, unmapped: 0, odcs: 0, odps: 0, rows: 0 });
  const blank = await pdfPages(createInterfaceReportPdf([])); assert.match(blank[0].text, /Tidak ada data sesuai filter/);
});

console.log(`\nLAPORAN INTERFACE: ${passed} pengujian lulus\n`);
