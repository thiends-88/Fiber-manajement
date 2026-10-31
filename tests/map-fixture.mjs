// Fixture geografis khusus pengujian; tidak pernah dimuat server/aplikasi.
export function mapFixture() {
  const gps = (latitude, longitude) => ({
    latitude,
    longitude,
    coordinate_mode: "manual",
  });
  const legacy = (location) => ({
    location,
    coordinate_mode: "location",
    latitude: null,
    longitude: null,
  });
  const cable = { cable_type: "48_core_4_tube" };
  const olts = [
    {
      id: 1,
      name: "OLT-C300-UJI-PETA",
      olt_type: "ZTE C300",
      interface_mode: "shelf_slot_port",
      location: "Alamat asli OLT",
      ip: "192.0.2.55",
      ...gps(-0.79, 100.64),
      password_hash: "DO_NOT_EXPORT_HASH",
    },
    {
      id: 2,
      name: "OLT-C320-UJI-PETA",
      olt_type: "ZTE C320",
      ...legacy("-0.8, 100.65"),
    },
    {
      id: 3,
      name: "OLT-model-manual-uji",
      olt_type: "Merek belum terdaftar",
      interface_mode: "custom",
      ...gps(0, 0),
    },
  ];
  const odcs = [
    { id: 1, olt_id: 1, name: "ODC-UJI-A", ...cable, ...gps(-0.79, 100.64) },
    { id: 2, olt_id: 1, name: "ODC-UJI-B", ...cable, ...gps(-0.81, 100.7) },
    { id: 3, olt_id: 2, name: "ODC-UJI-C", ...cable, ...gps(-0.82, 100.71) },
    {
      id: 4,
      olt_id: 1,
      name: "ODC-alamat-tanpa-gps",
      ...cable,
      location: "Jalan 12, Solok",
    },
    {
      id: 5,
      olt_id: 1,
      name: "ODC-titik-dinonaktifkan",
      ...cable,
      location: "-0.83, 100.72",
      coordinate_mode: "none",
    },
  ];
  const odps = [
    {
      id: 1,
      odc_id: 1,
      name: "ODP-UJI-A",
      ...cable,
      ...legacy("( -0.79, 100.64 )"),
    },
    {
      id: 2,
      odc_id: 1,
      name: '</name><script>alert(1)</script> & "tag" ]]>',
      location: '<img src=x onerror="alert(2)">',
      notes: "<& > \" ' ]]>&\u0000\ud800🌏",
      ...cable,
      ...gps(-0.83, 100.72),
    },
    { id: 3, odc_id: 2, name: "ODP-UJI-C", ...cable, ...gps(-0.84, 100.73) },
    {
      id: 4,
      odc_id: 3,
      name: "ODP-belum-gps",
      ...cable,
      location: "Tiang depan sekolah",
    },
    {
      id: 5,
      odc_id: 3,
      name: "ODP-gps-rusak-lama",
      ...cable,
      ...gps(100.6, -0.7),
    },
  ];
  const ports = [
    {
      id: 11,
      olt_id: 1,
      olt_type: "ZTE C300",
      interface_mode: "shelf_slot_port",
      shelf: 1,
      slot: 2,
      port: 1,
      status: "inactive",
    },
    { id: 12, olt_id: 1, shelf: 2, slot: 1, port: 1, status: "active" },
    { id: 21, olt_id: 2, shelf: 1, slot: 1, port: 1 },
  ];
  const feederPorts = [
    { odc_id: 1, port_id: 11 },
    { odc_id: 2, port_id: 12 },
    { odc_id: 3, port_id: 21 },
  ];
  const interfaceMappings = [{ id: 1, odc_id: 1, core: 1, port_id: 11 }];
  const splitters = [
    {
      id: 101,
      odc_id: 1,
      name: "SPL-UJI-ROOT",
      input_core: 1,
      ratio: "1:4",
      outputs: [
        { id: 1001, port: 1, target_type: "odp", target_odp_id: 1 },
        {
          id: 1002,
          port: 2,
          target_type: "odc",
          target_odc_id: 2,
          target_odc_splitter_id: 201,
        },
        { id: 1003, port: 3, target_type: "splitter", target_splitter_id: 102 },
      ],
    },
    {
      id: 102,
      odc_id: 1,
      name: "SPL-UJI-CASCADE",
      input_core: 1,
      input_splitter_id: 101,
      ratio: "1:4",
      outputs: [
        { id: 1004, port: 1, target_type: "odp", target_odp_id: 2 },
        { id: 1005, port: 2, target_type: "odc", target_odc_id: 3 },
      ],
    },
    {
      id: 201,
      odc_id: 2,
      name: "SPL-UJI-RECEIVER",
      input_core: null,
      outputs: [{ id: 2001, port: 1, target_type: "odp", target_odp_id: 3 }],
    },
    {
      id: 301,
      odp_id: 1,
      name: "SPL-UJI-DOWNSTREAM-ODP",
      input_core: 1,
      ratio: "1:8",
      outputs: [{ id: 3001, port: 1, target_type: "odp", target_odp_id: 2 }],
    },
  ];
  const links = [
    { id: 1, odc_id: 1, odc_core: 2, odp_id: 2, odp_core: 2 },
    { id: 2, odc_id: 1, odc_core: 3, odp_id: 1, odp_core: 2 },
  ];
  return {
    version: 1,
    olts,
    odcs,
    odps,
    ports,
    feederPorts,
    interfaceMappings,
    splitters,
    links,
  };
}
