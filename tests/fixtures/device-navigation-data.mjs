// Fixture API SINTETIS, hanya untuk server/database sementara pengujian.
export async function deviceNavigationData(request) {
  const post = (route, body) => request("POST", route, body);
  const olts = [];
  for (const model of ["ZTE C300", "ZTE C320"]) olts.push(await post("/api/olts", { name: `OLT-UJI-NAV-${model.split(" ").at(-1)}`, olt_type: model, location: "SINTETIS — bukan lokasi lapangan" }));
  const ports = [];
  for (const olt of olts) {
    const card = await post("/api/cards", { olt_id: olt.id, shelf: 1, slot: 1, card_type: "OTHER", port_count: 8 });
    ports.push(await post("/api/ports", { card_id: card.id, port: 1, status: "active", notes: "Port UJI saja" }));
  }
  const odcs = [];
  for (let i = 0; i < 62; i++) {
    const body = { name: i === 1 || i === 2 ? "ODC-NAMA-SAMA-UJI" : `ODC-UJI-NAV-${String(i + 1).padStart(3, "0")}`, olt_id: olts[i % 2].id, location: `Alamat sintetis ${i + 1}`, cable_type: "figure8_6_core", notes: `Catatan ODC lama ${i + 1}`, feeder_port_ids: i < 2 ? [ports[i].id] : [] };
    odcs.push({ ...body, ...await post("/api/odcs", body) });
  }
  const odps = [];
  for (let i = 0; i < 72; i++) {
    const body = { name: i === 1 || i === 2 ? "ODP-NAMA-SAMA-UJI" : `ODP-UJI-NAV-${String(i + 1).padStart(3, "0")}`, odc_id: odcs[i % odcs.length].id, location: `Tiang UJI ${i + 1}`, cable_type: "figure8_6_core", notes: `Catatan ODP lama ${i + 1}` };
    odps.push({ ...body, ...await post("/api/odps", body) });
  }
  for (let i = 0; i < 2; i++) await request("PUT", "/api/interface-mappings", { odc_id: odcs[i].id, core: 1, port_id: ports[i].id, notes: "Mapping eksplisit UJI" });
  await post("/api/cores", { source: "olt_to_odc", odc_id: odcs[0].id, core: 2, status: "reserved", notes: "Core lama ODC jangan diubah" });
  await post("/api/cores", { source: "odc_to_odp", odp_id: odps[0].id, core: 2, status: "reserved", notes: "Core lama ODP jangan diubah" });
  return { olts, ports, odcs, odps };
}
