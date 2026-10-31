// Data geografis sintetis khusus DB browser sementara; bukan seed aplikasi.
export async function mapLiveFixture(request) {
  const post = (route, body) => request("POST", route, body, 201);
  const gps = (latitude, longitude) => ({
    latitude,
    longitude,
    coordinate_mode: "manual",
  });
  const A = await post("/api/olts", {
    name: "OLT-PETA-C300",
    olt_type: "ZTE C300",
    ip: "192.0.2.45",
    location: "Ruang OLT fixture",
    ...gps(-0.79, 100.64),
  });
  const B = await post("/api/olts", {
    name: "OLT-PETA-C320",
    olt_type: "ZTE C320",
    location: "-0.80,100.65",
  });
  const H = await post("/api/olts", {
    name: "OLT-PETA-HSGQ",
    olt_type: "HSGQ XPON",
    fixed_port_count: 4,
    ...gps(-0.85, 100.68),
  });
  const cardA = await post("/api/cards", {
    olt_id: A.id,
    shelf: 1,
    slot: 2,
    card_type: "GTGO",
    port_count: 8,
  });
  const cardB = await post("/api/cards", {
    olt_id: B.id,
    shelf: 1,
    slot: 1,
    card_type: "GTGH",
    port_count: 16,
  });
  const portA = await post("/api/ports", {
    card_id: cardA.id,
    port: 1,
    status: "inactive",
  });
  const portF = await post("/api/ports", {
    card_id: cardA.id,
    port: 2,
    status: "active",
  });
  const portB = await post("/api/ports", {
    card_id: cardB.id,
    port: 1,
    status: "active",
  });
  const portH = await post("/api/ports", {
    olt_id: H.id,
    port: 1,
    status: "active",
  });
  const odc = (name, olt, extra = {}) =>
    post("/api/odcs", {
      name,
      olt_id: olt.id,
      cable_type: "48_core_4_tube",
      ...extra,
    });
  const R = await odc("ODC-PETA-ROOT", A, {
    location: "-0.79,100.64",
    feeder_port_ids: [portA.id],
  });
  const C = await odc("ODC-PETA-ANAK", A, gps(-0.81, 100.7));
  const D = await odc("ODC-PETA-BERSAMA", B, {
    ...gps(-0.82, 100.71),
    feeder_port_ids: [portB.id],
  });
  const F = await odc("ODC-PETA-FEEDER-BELUM-DIPETAKAN", A, {
    ...gps(-0.83, 100.69),
    feeder_port_ids: [portF.id],
  });
  const HD = await odc("ODC-PETA-HSGQ", H, {
    ...gps(-0.86, 100.69),
    feeder_port_ids: [portH.id],
  });
  const N = await odc("ODC-PETA-BELUM-GPS", A, {
    location: "Alamat kabinet tanpa GPS",
  });
  const odp = (name, parent, extra) =>
    post("/api/odps", {
      name,
      odc_id: parent.id,
      cable_type: "12_core_2_tube",
      ...extra,
    });
  const Q1 = await odp("ODP-PETA-KOLOKASI", R, {
    location: "( -0.79, 100.64 )",
  });
  const Q2 = await odp('<img src=x onerror="window.__mapXss=1"> & ]]>', R, {
    location: '<svg onload="window.__mapXss=2">',
    notes: "</description><script>window.__mapXss=3</script>",
    ...gps(-0.83, 100.72),
  });
  const Q3 = await odp("ODP-PETA-ANAK", C, gps(-0.84, 100.73));
  const Q4 = await odp("ODP-PETA-BELUM-GPS", D, {
    location: "Tiang depan sekolah, tanpa survei GPS",
  });
  const Q5 = await odp("ODP-PETA-GPS-TERBALIK", R, {
    location: "100.64,-0.79",
  });
  const splitter = (name, cabinet, input_core = null) =>
    post("/api/splitters", {
      name,
      odc_id: cabinet.id,
      ratio: "1:4",
      input_core,
    });
  const root = await splitter("SPL-PETA-ROOT", R, 1),
    cascade = await splitter("SPL-PETA-CASCADE", R);
  const recvC = await splitter("SPL-PETA-RECEIVER-C", C),
    recvD = await splitter("SPL-PETA-RECEIVER-D", D),
    directD = await splitter("SPL-PETA-DIRECT-D", D, 2),
    recvD2 = await splitter("SPL-PETA-RECEIVER-D2", D);
  const patchOutput = (out, target_type, target, extra = {}) =>
    request("PATCH", `/api/splitter-outputs/${out.id}`, {
      target_type,
      target_id: target.id,
      ...extra,
    });
  await patchOutput(root.outputs[0], "odp", Q1);
  await patchOutput(root.outputs[1], "odc", C, {
    target_odc_splitter_id: recvC.id,
  });
  await patchOutput(root.outputs[2], "splitter", cascade);
  await patchOutput(cascade.outputs[0], "odp", Q2);
  await patchOutput(cascade.outputs[1], "odc", D, {
    target_odc_splitter_id: recvD.id,
  });
  await patchOutput(recvC.outputs[0], "odp", Q3);
  await patchOutput(recvC.outputs[1], "odc", D, {
    target_odc_splitter_id: recvD2.id,
  });
  await patchOutput(recvD.outputs[0], "odp", Q4);
  const odpSplitter = (
    await request("GET", `/api/splitters?odp_id=${Q1.id}`)
  )[0];
  await patchOutput(odpSplitter.outputs[0], "odp", Q2);
  const direct = await post("/api/links", {
    odc_id: R.id,
    odc_core: 3,
    odp_id: Q2.id,
    odp_core: 2,
  });
  for (const [cabinet, core, port] of [
    [R, 1, portA],
    [D, 2, portB],
    [HD, 1, portH],
  ])
    await request("PUT", "/api/interface-mappings", {
      odc_id: cabinet.id,
      core,
      port_id: port.id,
    });
  return {
    A,
    B,
    H,
    R,
    C,
    D,
    F,
    HD,
    N,
    Q1,
    Q2,
    Q3,
    Q4,
    Q5,
    root,
    cascade,
    recvC,
    recvD,
    directD,
    recvD2,
    direct,
  };
}
