// Inventaris SINTETIS untuk detail peta, tidak pernah menjadi seed aplikasi.
export function odpConnectionFixture() {
  const cable = "24_core_4_tube";
  const olts = [
    { id: 1, name: "OLT-UJI-C300", olt_type: "ZTE C300" },
    { id: 2, name: "OLT-UJI-C320", olt_type: "ZTE C320" },
    { id: 3, name: "OLT-UJI-HSGQ", olt_type: "HSGQ XPON", interface_mode: "pon" },
  ];
  const odcs = [
    { id: 10, name: "ODC-UJI-PUSAT", olt_id: 1, cable_type: "48_core_4_tube" },
    { id: 20, name: "ODC-UJI-ANAK", olt_id: 1, cable_type: cable },
    { id: 30, name: "ODC-UJI-C320", olt_id: 2, cable_type: cable },
    { id: 40, name: "ODC-UJI-HSGQ", olt_id: 3, cable_type: cable },
  ];
  const ports = [
    { id: 11, olt_id: 1, shelf: 1, slot: 2, port: 1 },
    { id: 12, olt_id: 1, shelf: 1, slot: 3, port: 1 },
    { id: 21, olt_id: 2, shelf: 1, slot: 1, port: 1 },
    { id: 31, olt_id: 3, port: 3, interface_mode: "pon" },
  ];
  const odps = [
    { id: 101, name: "ODP-UJI-NAMA-SAMA", odc_id: 20, cable_type: cable, location: "Lokasi A sintetis", coordinate_mode: "manual", latitude: -0.79, longitude: 100.64 },
    { id: 202, name: "ODP-UJI-NAMA-SAMA", odc_id: 30, cable_type: "figure8_6_core", location: "Lokasi B sintetis", coordinate_mode: "manual", latitude: -0.80, longitude: 100.65 },
    { id: 303, name: "ODP-UJI-BELUM-TERSAMBUNG", odc_id: 10, cable_type: cable },
    { id: 404, name: "ODP-UJI-HSGQ", odc_id: 40, cable_type: cable },
    { id: 505, name: "ODP-UJI-PERANTARA", odc_id: 10, cable_type: cable },
  ];
  const feederPorts = [{ odc_id: 10, port_id: 11 }, { odc_id: 10, port_id: 12 }, { odc_id: 30, port_id: 21 }, { odc_id: 40, port_id: 31 }];
  const interfaceMappings = [{ id: 1, odc_id: 10, core: 7, port_id: 11 }, { id: 2, odc_id: 10, core: 8, port_id: 12 }, { id: 3, odc_id: 30, core: 2, port_id: 21 }, { id: 4, odc_id: 40, core: 1, port_id: 31 }];
  const splitters = [
    { id: 1, odc_id: 10, name: "SPL-UJI-PUSAT", input_core: 7, ratio: "1:4", outputs: [{ id: 11, port: 2, target_type: "splitter", target_splitter_id: 2 }] },
    { id: 2, odc_id: 10, name: "SPL-UJI-CASCADE", input_core: null, ratio: "1:8", outputs: [{ id: 21, port: 1, target_type: "odc", target_odc_id: 20, target_odc_splitter_id: 3 }] },
    { id: 3, odc_id: 20, name: "SPL-UJI-RECEIVER", input_core: 2, ratio: "1:8", outputs: [{ id: 31, port: 3, target_type: "odp", target_odp_id: 101 }] },
    { id: 4, odp_id: 101, name: "SPL-UJI-LOKAL-A", input_core: 7, ratio: "1:8", outputs: [] },
    { id: 5, odc_id: 40, name: "SPL-UJI-HSGQ", input_core: 1, ratio: "1:8", outputs: [{ id: 51, port: 1, target_type: "odp", target_odp_id: 404 }] },
  ];
  const links = [{ id: 1, odc_id: 30, odc_core: 2, odp_id: 202, odp_core: 3 }, { id: 2, odc_id: 10, odc_core: 8, odp_id: 505, odp_core: 1 }];
  const cores = [
    { id: 1, source: "odc_to_odp", odp_id: 101, core: 7, status: "used", destination: "PELANGGAN-UJI-A", notes: "Catatan core A sintetis" },
    { id: 2, source: "odc_to_odp", odp_id: 101, core: 3, status: "reserved", notes: "Cadangan A sintetis" },
    { id: 3, source: "odc_to_odp", odp_id: 202, core: 3, status: "damaged", notes: "Catatan core B sintetis" },
    { id: 4, source: "olt_to_odc", odc_id: 10, core: 7, status: "used", notes: "Jangan dianggap core power ODP" },
  ];
  return { version: 1, olts, odcs, odps, ports, feederPorts, interfaceMappings, splitters, links, cores };
}
export function odpDetailSnapshot(id = 101) {
  const fixture = odpConnectionFixture(), { cores, ...snapshot } = fixture;
  return { ...snapshot, odpDetail: { odpId: Number(id), readAt: "2026-10-19T00:00:00.000Z", cores: cores.filter(c => c.source === "odc_to_odp" && c.odp_id === Number(id)) } };
}
