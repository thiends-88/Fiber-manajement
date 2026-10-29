// Hanya dipanggil pengujian dengan API/database sementara; bukan data lapangan.
export async function dashboardFixture(request) {
  const post = (route, body) => request("POST", route, body, 201);
  const olt = (name, olt_type, extra = {}) => post("/api/olts", { name, olt_type, ...extra });
  const A = await olt("OLT-001", "ZTE C300"), B = await olt("OLT-002", "ZTE C320");
  const empty = await olt("OLT-010", "ZTE C300");
  const fixed = await olt("OLT-HSGQ", "HSGQ XPON", { fixed_port_count: 4 });
  const card = (device, shelf, slot, card_type, port_count) => post("/api/cards", { olt_id: device.id, shelf, slot, card_type, port_count });
  const a1 = await card(A, 1, 1, "GTGO", 8), a2 = await card(A, 1, 2, "GTHG", 16);
  const a3 = await card(A, 2, 1, "GTGO", 8), b1 = await card(B, 1, 1, "GTGH", 16);
  const aPorts = [];
  for (const [i, status] of ["active", "active", "inactive", "reserved", "damaged"].entries()) {
    aPorts.push(await post("/api/ports", { card_id: a1.id, port: i + 1, status }));
  }
  for (const [i, status] of ["active", "reserved"].entries()) await post("/api/ports", { card_id: a2.id, port: i + 1, status });
  const bPort = await post("/api/ports", { card_id: b1.id, port: 1, status: "active" });
  await post("/api/ports", { card_id: b1.id, port: 2, status: "inactive" });
  const fixedPort = await post("/api/ports", { olt_id: fixed.id, port: 1, status: "active" });
  await post("/api/ports", { olt_id: fixed.id, port: 2, status: "inactive" });
  const odc = (device, suffix, feeder_port_ids) => post("/api/odcs", { name: `ODC-DASH-${suffix}`, olt_id: device.id, cable_type: "figure8_6_core", feeder_port_ids });
  const da = await odc(A, "A", [aPorts[0].id, aPorts[2].id, aPorts[3].id]);
  const duplicateFeeder = await odc(A, "A2", [aPorts[3].id]);
  const db = await odc(B, "B", [bPort.id]), df = await odc(fixed, "F", [fixedPort.id]);
  const mappings = [];
  for (const [d, core, port] of [[da, 1, aPorts[0]], [da, 2, aPorts[2]], [db, 1, bPort], [df, 1, fixedPort]]) {
    mappings.push(await request("PUT", "/api/interface-mappings", { odc_id: d.id, core, port_id: port.id }));
  }
  // Banyak ODP dan cascade tidak memperbanyak hitungan port fisik sumber.
  const odp = (name) => post("/api/odps", { name, odc_id: da.id, cable_type: "figure8_6_core" });
  const odp1 = await odp("ODP-DASH-1"), odp2 = await odp("ODP-DASH-2");
  const root = await post("/api/splitters", { name: "SPL-DASH-1", odc_id: da.id, input_core: 1, ratio: "1:4" });
  const cascade = await post("/api/splitters", { name: "SPL-DASH-2", odc_id: da.id, input_core: null, ratio: "1:4" });
  await request("PATCH", `/api/splitter-outputs/${root.outputs[0].id}`, { target_type: "splitter", target_id: cascade.id });
  for (const [i, dest] of [odp1, odp2].entries()) await request("PATCH", `/api/splitter-outputs/${cascade.outputs[i].id}`, { target_type: "odp", target_id: dest.id });
  for (const [core, status] of [[1, "used"], [3, "reserved"], [4, "damaged"]]) await post("/api/cores", { source: "olt_to_odc", odc_id: da.id, core, status });
  return { A, B, empty, fixed, a1, a2, a3, b1, aPorts, bPort, da, mappings, root, cascade, duplicateFeeder };
}
