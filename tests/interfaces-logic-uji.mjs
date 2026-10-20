import assert from "node:assert/strict";
import { interfaceDetails, defaultInterfaceMode, interfaceLink, sortInterfaces } from "../src/lib/interfaces.js";
import { buildInterfaceRoutes, filterInterfaceGroups } from "../src/lib/interface-routes.js";
import { buildInterfaceTopology } from "../src/lib/interface-topology.js";
import { buildUpstreamChains } from "../src/lib/topology.js";

let count = 0;
function check(name, run) { run(); count++; console.log(`  OK    ${name}`); }
console.log("\n=== UJI INTERFACE: penamaan & pemisahan sumber ===");
check("C300/C320 memakai shelf/slot/port, HSGQ memakai port langsung", () => {
  assert.equal(defaultInterfaceMode("ZTE C300"), "shelf_slot_port");
  assert.equal(defaultInterfaceMode("ZTE C320"), "shelf_slot_port");
  assert.equal(defaultInterfaceMode("HSGQ XPON"), "pon");
  assert.deepEqual(interfaceDetails({ shelf: 1, slot: 2, port: 1 }, { olt_type: "ZTE C300" }), { interface_code: "1/2/1", interface_label: "GPON 1/2/1", interface_cli: "gpon-olt_1/2/1" });
});
check("format generik tidak mengarang perintah CLI ZTE", () => {
  assert.equal(interfaceDetails({ port: 4 }, { interface_mode: "pon" }).interface_label, "PON 4");
  assert.equal(interfaceDetails({ port: 4 }, { interface_mode: "pon" }).interface_cli, "");
  assert.equal(interfaceDetails({ interface_name: " EPON0/1 " }, { interface_mode: "custom" }).interface_label, "EPON0/1");
  assert.equal(interfaceDetails({ shelf: 1, slot: 2, port: 1 }, { olt_type: "Huawei MA5800" }).interface_cli, "");
});
check("urut interface numerik dan tautan memakai ID port, bukan nomor yang bisa kembar", () => {
  assert.deepEqual(sortInterfaces([{ id: 10, olt_id: 1, slot: 10, port: 1 }, { id: 2, olt_id: 1, slot: 2, port: 1 }]).map((p) => p.id), [2, 10]);
  assert.equal(interfaceLink({ id: 8, port_id: 22, olt_id: 3 }), "/?olt=3&interface=22");
});

const cable_type = "24_core_4_tube";
const input = {
  olts: [{ id: 1, name: "OLT-C300", olt_type: "ZTE C300" }, { id: 2, name: "OLT-C320", olt_type: "ZTE C320" }],
  ports: [{ id: 11, olt_id: 1, shelf: 1, slot: 1, port: 1 }, { id: 12, olt_id: 1, shelf: 1, slot: 2, port: 1 }, { id: 21, olt_id: 2, shelf: 1, slot: 1, port: 1 }],
  odcs: [{ id: 1, olt_id: 1, name: "ODC-PUSAT", cable_type }, { id: 2, olt_id: 1, name: "ODC-ANAK", cable_type }, { id: 3, olt_id: 2, name: "ODC-LAIN", cable_type }],
  odps: [{ id: 1, odc_id: 1, name: "ODP-A", cable_type }, { id: 2, odc_id: 1, name: "ODP-B", cable_type }, { id: 3, odc_id: 2, name: "ODP-C", cable_type }, { id: 4, odc_id: 2, name: "ODP-D", cable_type }, { id: 5, odc_id: 1, name: "ODP-LANGSUNG", cable_type }, { id: 6, odc_id: 3, name: "ODP-OLT-LAIN", cable_type }, { id: 7, odc_id: 1, name: "ODP-KOSONG", cable_type }],
  feederPorts: [{ odc_id: 1, port_id: 11 }, { odc_id: 1, port_id: 12 }, { odc_id: 3, port_id: 21 }],
  interfaceMappings: [{ id: 1, odc_id: 1, core: 1, port_id: 11 }, { id: 2, odc_id: 1, core: 2, port_id: 12 }, { id: 3, odc_id: 3, core: 1, port_id: 21 }],
  splitters: [
    { id: 1, odc_id: 1, name: "SPL-A", ratio: "1:4", input_core: 1, outputs: [{ port: 1, target_type: "splitter", target_splitter_id: 2 }] },
    { id: 2, odc_id: 1, name: "SPL-A2", ratio: "1:8", input_core: 1, outputs: [{ port: 1, target_type: "odp", target_odp_id: 1 }, { port: 2, target_type: "odc", target_odc_id: 2, target_odc_splitter_id: 4 }] },
    { id: 3, odc_id: 1, name: "SPL-B", ratio: "1:4", input_core: 2, outputs: [{ port: 1, target_type: "odp", target_odp_id: 2 }, { port: 2, target_type: "odc", target_odc_id: 2, target_odc_splitter_id: 5 }] },
    // ODC dan nomor core sama, tetapi splitter/kabel penerima berbeda.
    { id: 4, odc_id: 2, name: "SPL-ANAK-A", ratio: "1:8", input_core: 1, outputs: [{ port: 1, target_type: "odp", target_odp_id: 3 }] },
    { id: 5, odc_id: 2, name: "SPL-ANAK-B", ratio: "1:8", input_core: 1, outputs: [{ port: 1, target_type: "odp", target_odp_id: 4 }] },
    { id: 6, odc_id: 3, name: "SPL-OLT-LAIN", ratio: "1:8", input_core: 1, outputs: [{ port: 1, target_type: "odp", target_odp_id: 6 }] },
    { id: 7, odp_id: 3, name: "SPL-ODP-C", ratio: "1:8", input_core: 1, outputs: [] },
  ],
  links: [{ id: 1, odc_id: 1, odc_core: 3, odp_id: 5, odp_core: 2 }], cores: [],
};
const routes = buildInterfaceRoutes(input);
check("setiap interface hanya berisi ODP pada cabangnya walau memakai ODC yang sama", () => {
  assert.deepEqual([...filterInterfaceGroups(routes.groups, { portId: 11 })[0].odpIds], [1, 3]);
  assert.deepEqual([...filterInterfaceGroups(routes.groups, { portId: 12 })[0].odpIds], [2, 4]);
});
check("receiver ODC anak tidak digambar sebagai feeder OLT kedua", () => {
  assert.equal(routes.groups.filter((g) => g.odc.id === 2).length, 0);
  assert.equal(routes.odpOrigins.get(3)[0].port.id, 11);
  assert.equal(routes.odpOrigins.get(4)[0].port.id, 12);
  assert.match(routes.odpOrigins.get(3)[0].text, /SPL-A.*out 1.*SPL-A2.*out 2.*ODC-ANAK.*SPL-ANAK-A/);
});
check("dua OLT dengan 1/1/1 tetap difilter dan dikenali terpisah", () => {
  assert.deepEqual(filterInterfaceGroups(routes.groups, { oltId: 2 }).map((g) => g.port.id), [21]);
  assert.equal(routes.odpOrigins.get(6)[0].port.id, 21);
});
check("kabel langsung yang belum dipetakan tidak mengambil port pertama ODC", () => {
  const origin = routes.odpOrigins.get(5)[0];
  assert.equal(origin.port, null);
  assert.match(origin.text, /belum dipetakan/);
  assert.match(origin.text, /C3 → C2/);
  assert.equal(filterInterfaceGroups(routes.groups, { portId: "unmapped" }).length, 1);
});
check("satu port dalam daftar feeder tidak otomatis menjadi sumber semua core", () => {
  const noMaps = buildInterfaceRoutes({ ...input, interfaceMappings: [] });
  assert.ok(noMaps.groups.every((g) => !g.port));
  assert.ok(noMaps.odpOrigins.get(6).every((o) => !o.port));
});
check("mapping rusak, port hilang, atau feeder terlepas tidak dipakai sebagai sumber terkonfirmasi", () => {
  const missing = buildInterfaceRoutes({ ...input, ports: input.ports.filter((p) => p.id !== 11) });
  assert.equal(missing.odpOrigins.get(1)[0].port, null);
  const invalid = buildInterfaceRoutes({ ...input, interfaceMappings: [{ odc_id: 1, core: 1, port_id: 21 }] });
  assert.equal(invalid.odpOrigins.get(1)[0].port, null);
  const detached = buildInterfaceRoutes({ ...input, feederPorts: [] });
  assert.equal(detached.odpOrigins.get(1)[0].port, null);
});
check("receiver belum dipilih tidak ditebak dari nomor core", () => {
  const legacy = structuredClone(input);
  delete legacy.splitters[1].outputs[1].target_odc_splitter_id;
  legacy.splitters[1].outputs[1].target_odc_core = 1;
  const result = buildInterfaceRoutes(legacy);
  assert.ok(!filterInterfaceGroups(result.groups, { portId: 11 })[0].odpIds.has(3));
  assert.equal(result.odpOrigins.get(3)[0].port, null);
});
check("pencarian ODP anak mempertahankan sumber dan jalur lengkap", () => {
  const result = filterInterfaceGroups(routes.groups, { query: "ODP-C" });
  assert.equal(result.length, 1);
  assert.equal(result[0].port.id, 11);
  assert.equal(filterInterfaceGroups(routes.groups, { query: "gpon-olt_1/2/1" })[0].port.id, 12);
});
check("graf tidak menyatukan sumber pada simpul ODC bersama", () => {
  const graph = buildInterfaceTopology({ ...routes, odcs: input.odcs });
  for (const [name, id] of [["ODP-C", 11], ["ODP-D", 12]]) {
    const node = graph.nodes.find((n) => n.fullTitle === name);
    const chains = buildUpstreamChains(graph, node.id, { maxKedalaman: 80 });
    assert.equal(chains.length, 1);
    assert.deepEqual(chains[0].langkah.filter((s) => s.node.kind === "interface").map((s) => s.node.sourcePort.id), [id]);
    assert.ok(chains[0].lengkap);
  }
  assert.ok(graph.edges.every((e) => Number.isFinite(e.x1) && Number.isFinite(e.y2)));
  assert.equal(new Set(graph.nodes.map((n) => n.id)).size, graph.nodes.length);
});
check("graf filter interface tidak membawa ODP milik interface lain", () => {
  const selected = filterInterfaceGroups(routes.groups, { portId: 11 });
  const graph = buildInterfaceTopology({ groups: selected, odcs: input.odcs });
  assert.ok(graph.nodes.some((n) => n.fullTitle === "ODP-C"));
  assert.ok(!graph.nodes.some((n) => ["ODP-B", "ODP-D", "ODP-OLT-LAIN", "ODP-KOSONG"].includes(n.fullTitle)));
});
check("ODP belum tersambung tetap terpisah dari semua interface", () => {
  assert.deepEqual(routes.unconnectedOdps.map((o) => o.id), [7]);
  const graph = buildInterfaceTopology({ ...routes, odcs: input.odcs });
  const chains = buildUpstreamChains(graph, "disconnected-odp-7");
  assert.ok(chains.every((c) => c.langkah.every((s) => s.node.kind !== "interface")));
});
check("input feeder ganda tidak dianggap sebagai sumber terkonfirmasi", () => {
  const duplicate = structuredClone(input);
  duplicate.links.push({ id: 99, odc_id: 1, odc_core: 1, odp_id: 5, odp_core: 3 });
  const result = buildInterfaceRoutes(duplicate);
  const group = result.groups.find((g) => g.odc.id === 1 && g.core === 1);
  assert.equal(group.port, null);
  assert.equal(group.inputConflict, true);
  assert.equal(filterInterfaceGroups(result.groups, { portId: 11 }).length, 0);
});
check("input core belum diisi tetap terlihat tanpa mengarang source", () => {
  const broken = structuredClone(input);
  broken.splitters[0].input_core = null;
  const result = buildInterfaceRoutes(broken);
  const origin = result.odpOrigins.get(1)[0];
  assert.equal(origin.port, null);
  assert.equal(origin.core, null);
});
check("siklus legacy diterminasi, tidak loop selamanya", () => {
  const broken = structuredClone(input);
  broken.splitters[3].outputs.push({ port: 2, target_type: "splitter", target_splitter_id: 1 });
  const result = buildInterfaceRoutes(broken);
  assert.ok(result.groups.length < 10);
  assert.doesNotThrow(() => buildInterfaceTopology({ ...result, odcs: input.odcs }));
});
const insideFixture = {
  ...input,
  odps: [{ id: 100, odc_id: 1, name: "ODP-BERSAMA", cable_type }, { id: 201, odc_id: 1, name: "ODP-HILIR-A", cable_type }, { id: 202, odc_id: 1, name: "ODP-HILIR-B", cable_type }],
  links: [{ id: 1, odc_id: 1, odc_core: 1, odp_id: 100, odp_core: 1 }, { id: 2, odc_id: 1, odc_core: 2, odp_id: 100, odp_core: 2 }],
  splitters: [
    { id: 101, odp_id: 100, name: "SPL-ODP-A", ratio: "1:8", input_core: 1, outputs: [{ port: 1, target_type: "odp", target_odp_id: 201 }] },
    { id: 102, odp_id: 100, name: "SPL-ODP-B", ratio: "1:8", input_core: 2, outputs: [{ port: 1, target_type: "odp", target_odp_id: 202 }] },
  ],
};
check("dua input ODP hanya memasok splitter internal dengan core yang cocok", () => {
  const result = buildInterfaceRoutes(insideFixture);
  assert.equal(result.odpOrigins.get(201).length, 1);
  assert.equal(result.odpOrigins.get(201)[0].port.id, 11);
  assert.equal(result.odpOrigins.get(202).length, 1);
  assert.equal(result.odpOrigins.get(202)[0].port.id, 12);
});
check("core masuk ODP belum diketahui tidak ditebak dari inventaris splitter", () => {
  const result = buildInterfaceRoutes({ ...insideFixture, links: [], splitters: [
    ...insideFixture.splitters,
    { id: 50, odc_id: 1, name: "SPL-FEED", ratio: "1:4", input_core: 1, outputs: [{ port: 1, target_type: "odp", target_odp_id: 100 }] },
  ] });
  assert.equal(result.odpOrigins.get(100)[0].port.id, 11);
  assert.equal(result.odpOrigins.has(201), false);
  assert.equal(result.odpOrigins.has(202), false);
});
check("data kosong aman", () => {
  assert.deepEqual(buildInterfaceRoutes().groups, []);
  assert.equal(buildInterfaceTopology().nodes.length, 0);
});
console.log(`\nINTERFACE LOGIKA: ${count} pemeriksaan lolos`);
