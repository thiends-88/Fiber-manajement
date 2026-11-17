import assert from "node:assert/strict";
import { buildOdpConnections, describeCore, summarizeOdpConnections } from "../src/lib/odp-connections.js";
import { validateMapSnapshot, validateOdpSnapshot } from "../src/lib/map-snapshot.js";
import { odpConnectionFixture, odpDetailSnapshot } from "./fixtures/odp-connections.mjs";
let passed = 0;
function check(name, fn) { fn(); passed++; console.log("OK   ", name); }
function result(change = () => {}, selected = 101) { const data = odpConnectionFixture(); change(data); return buildOdpConnections(data, selected); }
const first = detail => detail.routes[0];
console.log("\n=== DETAIL SAMBUNGAN ODP — PENELUSURAN READ-ONLY ===");
check("C300: receiver ODC eksplisit mempertahankan OLT, interface, core dan seluruh output", () => {
  const d = result(), route = first(d);
  assert.equal(route.status, "mapped"); assert.equal(route.olt.id, 1); assert.equal(route.port.interface_label, "GPON 1/2/1");
  assert.deepEqual(route.steps.map(s => s.label), ["OLT-UJI-C300", "GPON 1/2/1", "ODC-UJI-PUSAT", "SPL-UJI-PUSAT", "SPL-UJI-CASCADE", "ODC-UJI-ANAK", "SPL-UJI-RECEIVER", "ODP-UJI-NAMA-SAMA"]);
  assert.deepEqual(route.steps.filter(s => s.output != null).map(s => s.output), [2, 1, 3]);
  assert.equal(route.steps.find(s => s.kind === "odc").core.color, "Merah");
});
check("C320: kabel langsung menjaga core ODC dan core ODP berbeda", () => {
  const d = result(() => {}, 202), route = first(d);
  assert.equal(route.status, "mapped"); assert.equal(route.olt.id, 2); assert.equal(route.port.interface_cli, "gpon-olt_1/1/1");
  assert.equal(route.steps.find(s => s.kind === "odc").core.number, 2); assert.equal(route.steps.at(-1).core.number, 3);
});
check("HSGQ: PON langsung tanpa mengarang shelf/slot atau CLI ZTE", () => {
  const route = first(result(() => {}, 404));
  assert.equal(route.port.interface_label, "PON 3"); assert.equal(route.port.interface_cli, ""); assert.equal(route.olt.id, 3);
});
check("dua nama ODP sama tetap memakai ID dan catatan core masing-masing", () => {
  const a = result(), b = result(() => {}, 202);
  assert.equal(a.odp.name, b.odp.name); assert.notEqual(first(a).port.id, first(b).port.id);
  assert.equal(a.powerCores.find(c => c.number === 7).records[0].notes, "Catatan core A sintetis");
  assert.equal(b.powerCores.find(c => c.number === 3).records[0].notes, "Catatan core B sintetis");
});
check("warna/tube core power memakai kabel ODP, bukan warna feeder ODC", () => {
  const d = result(), core = d.powerCores.find(c => c.number === 7);
  assert.equal(core.color, "Biru"); assert.equal(core.tube, 2); assert.equal(core.records[0].status, "used");
  assert.deepEqual(d.powerCores.map(c => c.number), [3, 7]); assert.equal(core.usages.length, 1);
  assert.ok(!JSON.stringify(d.powerCores).includes("Jangan dianggap"));
});
check("core yang terpakai otomatis tetap tampil tanpa memalsukan status manual", () => {
  const d = result(data => { data.cores = []; });
  assert.equal(d.powerCores.length, 1); assert.equal(d.powerCores[0].number, 7); assert.equal(d.powerCores[0].records.length, 0);
  assert.match(d.powerCores[0].usages[0], /SPL-UJI-LOKAL/);
});
check("ODP tanpa sambungan tidak mengambil port dari ODC/OLT induk", () => {
  const d = result(() => {}, 303);
  assert.equal(d.inventoryOlt.id, 1); assert.equal(d.routes.length, 0); assert.deepEqual(d.powerCores, []);
});
check("mapping hilang: jalur hilir dipertahankan tetapi sumber OLT tidak ditebak", () => {
  const d = result(data => { data.interfaceMappings = []; });
  assert.equal(first(d).status, "partial"); assert.equal(first(d).olt, null); assert.equal(first(d).port, null);
  assert.ok(first(d).steps.some(s => s.label === "SPL-UJI-RECEIVER"));
});
for (const [name, change] of [
  ["port hilang", d => { d.ports = d.ports.filter(p => p.id !== 11); }],
  ["feeder terlepas", d => { d.feederPorts = []; }],
  ["mapping lintas OLT", d => { d.interfaceMappings[0].port_id = 21; }],
  ["mapping core ganda", d => { d.interfaceMappings.push({ ...d.interfaceMappings[0], id: 99 }); }],
  ["satu port dipetakan dua kali", d => { d.interfaceMappings.push({ id: 99, odc_id: 10, core: 12, port_id: 11 }); }],
  ["input feeder ganda", d => { d.links.push({ id: 99, odc_id: 10, odc_core: 7, odp_id: 303, odp_core: 1 }); }],
  ["core feeder melewati kapasitas", d => { d.splitters[0].input_core = 99; }],
]) check(`${name}: tidak menghasilkan sumber terpetakan`, () => {
  const d = result(change); assert.notEqual(first(d).status, "mapped"); assert.equal(first(d).port, null);
});
check("receiver tidak dipilih tidak ditebak berdasarkan kesamaan core", () => {
  const d = result(data => { delete data.splitters[1].outputs[0].target_odc_splitter_id; data.splitters[1].outputs[0].target_odc_core = 2; });
  assert.equal(first(d).status, "partial"); assert.equal(first(d).port, null);
  assert.ok(!first(d).steps.some(s => s.label === "SPL-UJI-PUSAT"));
});
check("receiver salah kabinet tidak dianggap feeder langsung yang valid", () => {
  const d = result(data => { data.splitters[1].outputs[0].target_odc_id = 30; });
  assert.equal(first(d).status, "review"); assert.equal(first(d).port, null);
});
check("receiver ODC dengan core di luar kapasitas ditandai tanpa mengarang warna/tube", () => {
  const d = result(data => { data.splitters[2].input_core = 99; });
  assert.equal(first(d).status, "review");
  assert.equal(first(d).steps.find(s => s.kind === "odc" && s.id === 20).core, null);
  assert.match(first(d).issues.join(" "), /kapasitas/);
});
check("receiver beberapa input ditandai konflik, bukan dipilih port pertama", () => {
  const d = result(data => { data.splitters[0].outputs.push({ id: 99, port: 4, target_type: "odc", target_odc_id: 20, target_odc_splitter_id: 3 }); });
  assert.equal(d.routes.length, 2); assert.ok(d.routes.every(r => r.status === "review"));
});
check("cascade lintas induk tidak ditelusuri sebagai kabel sah", () => {
  const d = result(data => { data.splitters[1].odc_id = 30; });
  assert.equal(first(d).status, "review"); assert.equal(first(d).port, null);
});
check("nomor output tidak valid/duplikat dan target ganda ditandai", () => {
  for (const change of [d => { d.splitters[2].outputs[0].port = 99; }, d => { d.splitters[2].outputs.push({ ...d.splitters[2].outputs[0], id: 99 }); }, d => { d.splitters[2].outputs[0].target_odc_id = 10; }]) {
    const d = result(change); assert.ok(d.routes.every(r => r.status === "review"));
  }
});
check("nomor core masuk ODP dari output splitter tetap tidak diketahui", () => { assert.equal(first(result()).steps.at(-1).core, null); });
check("ODP perantara hanya mengikat splitter melalui core masuk kabel langsung yang cocok", () => {
  const d = result(data => { data.splitters.push({ id: 60, odp_id: 505, name: "SPL-PERANTARA", input_core: 1, ratio: "1:8", outputs: [{ id: 601, port: 2, target_type: "odp", target_odp_id: 303 }] }); }, 303);
  assert.equal(first(d).status, "mapped"); assert.equal(first(d).port.id, 12);
  assert.equal(first(d).steps.find(s => s.kind === "odp" && s.id === 505).core.number, 1);
});
check("core masuk yang belum diketahui tidak dipasangkan otomatis dengan splitter ODP", () => {
  const d = result(data => {
    data.links = data.links.filter(l => l.odp_id !== 505);
    data.splitters[0].outputs.push({ id: 99, port: 4, target_type: "odp", target_odp_id: 505 });
    data.splitters.push({ id: 60, odp_id: 505, name: "SPL-PERANTARA", input_core: 1, ratio: "1:8", outputs: [{ id: 601, port: 2, target_type: "odp", target_odp_id: 303 }] });
  }, 303);
  assert.equal(first(d).status, "partial"); assert.equal(first(d).port, null); assert.match(first(d).issues.join(" "), /tidak ditebak/);
});
check("core ODP sama pada dua splitter root tidak menghasilkan jalur terkonfirmasi", () => {
  const d = result(data => { for (const n of [60, 61]) data.splitters.push({ id: n, odp_id: 505, name: `SPL-${n}`, input_core: 1, ratio: "1:8", outputs: [{ id: n * 10, port: 2, target_type: "odp", target_odp_id: 303 }] }); }, 303);
  assert.equal(d.routes.length, 2); assert.ok(d.routes.every(r => r.status === "review"));
});
check("beberapa jalur ODP ditampilkan terpisah, tidak disatukan berdasarkan nama/induk", () => {
  const d = result(data => { data.splitters.push({ id: 60, odp_id: 505, name: "SPL-PERANTARA", input_core: 1, ratio: "1:8", outputs: [{ id: 601, port: 2, target_type: "odp", target_odp_id: 101 }] }); });
  assert.equal(d.routes.length, 2); assert.deepEqual(d.routes.map(r => r.port.id).sort(), [11, 12]);
});
check("ringkasan mendahulukan jalur terpetakan tanpa membuang jalur hulu yang belum lengkap", () => {
  const d = result(data => {
    data.links.unshift({ id: 99, odc_id: 20, odc_core: 3, odp_id: 101, odp_core: 1 });
  });
  assert.equal(d.routes.length, 2);
  assert.equal(d.routes[0].status, "mapped"); assert.equal(d.routes[0].port.id, 11);
  assert.equal(d.routes[1].status, "partial"); assert.equal(d.routes[1].port, null);
});
check("beberapa kabel menuju core ODP yang sama tidak dilabeli sumber terkonfirmasi", () => {
  const d = result(data => { data.links.push({ id: 99, odc_id: 30, odc_core: 3, odp_id: 202, odp_core: 3 }); }, 202);
  assert.equal(d.routes.length, 2); assert.ok(d.routes.every(r => r.status === "review"));
});
check("siklus splitter berhenti dan tidak menghasilkan sumber OLT palsu", () => {
  const d = result(data => { data.splitters[1].outputs.push({ id: 22, port: 2, target_type: "splitter", target_splitter_id: 1 }); });
  assert.ok(d.routes.length); assert.equal(first(d).status, "review"); assert.equal(first(d).port, null);
});
check("ledakan jalur legacy dibatasi tanpa membekukan UI", () => {
  const start = performance.now();
  const d = result(data => { for (let n = 100; n < 180; n++) data.splitters.push({ id: n, odc_id: 10, name: `SPL-${n}`, input_core: null, ratio: "1:8", outputs: [{ id: n * 10, port: 1, target_type: "odp", target_odp_id: 101 }] }); });
  assert.equal(d.truncated, true); assert.ok(d.routes.length <= 24); assert.ok(performance.now() - start < 500);
});
check("core tidak valid tidak diberi warna/tube seolah valid", () => {
  for (const value of [null, "", 0, -1, true, 25, "1e1"]) assert.equal(describeCore(value, "24_core_4_tube"), null);
  assert.equal(describeCore(1, "unknown"), null);
  const d = result(data => { data.cores.push({ source: "odc_to_odp", odp_id: 101, core: 99, status: "used" }); });
  assert.ok(d.warnings.some(w => w.includes("99"))); assert.ok(!d.powerCores.some(c => c.number === 99));
});
check("penelusuran tidak mengubah records, IDs, GPS, notes, atau fields legacy", () => {
  const data = odpConnectionFixture(); data.cores[0].power_dbm = -17.5; const before = JSON.stringify(data);
  buildOdpConnections(data, 101); assert.equal(JSON.stringify(data), before);
});
check("ODP hilang dan data kosong aman", () => { assert.equal(buildOdpConnections({}, 101), null); assert.equal(buildOdpConnections(odpConnectionFixture(), 999), null); });
check("kontrak snapshot menolak ID tertukar, payload rusak, dan versi API tidak sesuai", () => {
  assert.equal(validateOdpSnapshot(odpDetailSnapshot(), 101).version, 1);
  for (const value of [{ ...odpDetailSnapshot(), version: 2 }, { ...odpDetailSnapshot(), ports: null }, { ...odpDetailSnapshot(), odpDetail: undefined }, odpDetailSnapshot(202)]) assert.throws(() => validateOdpSnapshot(value, 101));
  for (const patch of [{ odp_id: 202 }, { source: "olt_to_odc" }]) {
    const value = odpDetailSnapshot(); Object.assign(value.odpDetail.cores[0], patch);
    assert.throws(() => validateOdpSnapshot(value, 101));
  }
  assert.equal(validateMapSnapshot(odpDetailSnapshot()).version, 1);
});
check("popup ringkas: core ODP sendiri, interface singkat dan ODC terakhir pada jalur sah", () => {
  const summary = summarizeOdpConnections(result());
  assert.deepEqual(summary.cores.map(c => c.number), [7]);
  assert.equal(summary.cores[0].color, "Biru"); assert.equal(summary.cores[0].tube, 2);
  assert.equal(summary.sources[0].interface, "1/2/1"); assert.equal(summary.sources[0].odcName, "ODC-UJI-ANAK");
  assert.equal(summary.sources[0].oltName, "OLT-UJI-C300");
});
check("popup PON HSGQ dan nama manual tidak dipaksa menjadi interface ZTE", () => {
  assert.equal(summarizeOdpConnections(result(() => {}, 404)).sources[0].interface, "PON 3");
  const summary = summarizeOdpConnections(result(d => { d.olts[0].interface_mode = "custom"; d.ports[0].interface_name = "EPON0/1"; }));
  assert.equal(summary.sources[0].interface, "EPON0/1");
});
check("popup tanpa sambungan tidak mengambil ODC inventaris sebagai asal", () => {
  const summary = summarizeOdpConnections(result(() => {}, 303));
  assert.equal(summary.cores.length, 0); assert.equal(summary.sources[0].odcName, undefined);
  assert.equal(summary.sources[0].interface, "Interface / ODC asal belum dipetakan");
});
check("popup mapping hilang tetap menyebut ODC eksplisit tanpa mengarang interface", () => {
  const summary = summarizeOdpConnections(result(d => { d.interfaceMappings = []; }));
  assert.equal(summary.sources[0].interface, "Interface belum dipetakan");
  assert.equal(summary.sources[0].odcName, "ODC-UJI-ANAK");
});
check("popup mapping/receiver konflik tidak memilih salah satu sumber", () => {
  const summary = summarizeOdpConnections(result(d => { d.splitters[0].outputs.push({ id: 99, port: 4, target_type: "odc", target_odc_id: 20, target_odc_splitter_id: 3 }); }));
  assert.equal(summary.sources.length, 1); assert.equal(summary.sources[0].interface, "Asal perlu verifikasi");
  assert.equal(summary.sources[0].odcName, undefined);
});
check("popup memadatkan pasangan sumber identik berdasarkan ID tanpa mengubah rincian jalur", () => {
  const detail = result(d => { d.splitters[2].outputs.push({ id: 99, port: 4, target_type: "odp", target_odp_id: 101 }); });
  const before = JSON.stringify(detail), summary = summarizeOdpConnections(detail);
  assert.equal(summary.sources.length, 1); assert.equal(detail.routes.length, 2); assert.equal(JSON.stringify(detail), before);
});
check("popup beberapa sumber tetap mempertahankan interface/ODC masing-masing", () => {
  const summary = summarizeOdpConnections(result(d => { d.splitters.push({ id: 60, odp_id: 505, name: "SPL-ALT", input_core: 1, ratio: "1:8", outputs: [{ id: 601, port: 2, target_type: "odp", target_odp_id: 101 }] }); }));
  assert.equal(summary.sources.length, 2);
  assert.deepEqual(summary.sources.map(s => `${s.interface} — ${s.odcName}`).sort(), ["1/2/1 — ODC-UJI-ANAK", "1/3/1 — ODC-UJI-PUSAT"]);
});
check("popup sumber terpetakan tidak menyembunyikan adanya sambungan lain yang belum lengkap", () => {
  const summary = summarizeOdpConnections(result(d => { d.links.push({ id: 99, odc_id: 20, odc_core: 3, odp_id: 101, odp_core: 1 }); }));
  assert.equal(summary.sources.length, 1); assert.equal(summary.sources[0].interface, "1/2/1");
  assert.match(summary.notice, /Sebagian sambungan belum dipetakan/);
});
check("popup core cadangan/rusak tidak dianggap manual terpakai, pemakaian nyata terdeteksi tetap terbaca", () => {
  const detail = result(() => {}, 202), summary = summarizeOdpConnections(detail);
  assert.equal(summary.cores.length, 1); assert.equal(summary.cores[0].records[0].status, "damaged");
  assert.ok(summary.cores[0].usages.length);
  detail.powerCores[0].usages = [];
  assert.equal(summarizeOdpConnections(detail).cores.length, 0);
});
console.log(`\nDETAIL ODP LOGIKA: ${passed} pemeriksaan lulus.`);
