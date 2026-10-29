// Dua OLT memakai 1/1/1; satu ODC anak menerima dua cabang berbeda.
const cable_type = "24_core_4_tube";
export function reportNetwork() {
  return {
    olts: [
      { id: 1, name: "OLT-C300", olt_type: "ZTE C300", interface_mode: "shelf_slot_port" },
      { id: 2, name: "OLT-C320", olt_type: "ZTE C320", interface_mode: "shelf_slot_port" },
      { id: 3, name: "OLT-HSGQ", olt_type: "HSGQ XPON", interface_mode: "pon" },
    ],
    ports: [
      { id: 11, olt_id: 1, shelf: 1, slot: 1, port: 1, status: "active" },
      { id: 12, olt_id: 1, shelf: 1, slot: 2, port: 1, status: "reserved" },
      { id: 13, olt_id: 1, shelf: 1, slot: 2, port: 2, status: "inactive" },
      { id: 14, olt_id: 1, shelf: 1, slot: 2, port: 3, status: "damaged" },
      { id: 15, olt_id: 1, shelf: 1, slot: 2, port: 4, status: "active" },
      { id: 21, olt_id: 2, shelf: 1, slot: 1, port: 1, status: "active" },
      { id: 31, olt_id: 3, port: 1, status: "active" },
    ],
    odcs: [
      { id: 1, olt_id: 1, name: "ODC-PUSAT", cable_type },
      { id: 2, olt_id: 1, name: "ODC-ANAK", location: "Simpang anak", cable_type },
      { id: 3, olt_id: 2, name: "ODC-LAIN", cable_type },
    ],
    odps: [
      { id: 1, odc_id: 1, name: "ODP-A", location: "Pasar A", cable_type },
      { id: 2, odc_id: 1, name: "ODP-B", location: "Pasar B", cable_type },
      { id: 3, odc_id: 2, name: "ODP-C", location: "Ujung Solok", cable_type },
      { id: 4, odc_id: 2, name: "ODP-D", location: "Koto Baru", cable_type },
      { id: 5, odc_id: 1, name: "ODP-LANGSUNG", location: "Jl. Utama", cable_type },
      { id: 6, odc_id: 3, name: "ODP-OLT-LAIN", cable_type },
      { id: 7, odc_id: 1, name: "ODP-TAK-TERSAMBUNG", cable_type },
      { id: 8, odc_id: 1, name: "ODP-BELUM-DIPETAKAN", cable_type },
    ],
    feederPorts: [11, 12, 13, 14, 15].map((port_id) => ({ odc_id: 1, port_id })).concat([{ odc_id: 3, port_id: 21 }]),
    interfaceMappings: [
      { id: 1, odc_id: 1, core: 1, port_id: 11, notes: "ODF tray 1 / kabel A" },
      { id: 2, odc_id: 1, core: 2, port_id: 12 },
      { id: 3, odc_id: 3, core: 1, port_id: 21 },
      { id: 4, odc_id: 1, core: 7, port_id: 13 },
      { id: 5, odc_id: 1, core: 8, port_id: 14, notes: "Disiapkan, hilir belum dicatat" },
    ],
    splitters: [
      { id: 1, odc_id: 1, name: "SPL-A", ratio: "1:4", input_core: 1, outputs: [{ port: 1, target_type: "splitter", target_splitter_id: 2 }] },
      { id: 2, odc_id: 1, name: "SPL-A2", ratio: "1:8", input_core: null, outputs: [{ port: 1, target_type: "odp", target_odp_id: 1 }, { port: 2, target_type: "odc", target_odc_id: 2, target_odc_splitter_id: 4 }] },
      { id: 3, odc_id: 1, name: "SPL-B", ratio: "1:4", input_core: 2, outputs: [{ port: 1, target_type: "odp", target_odp_id: 2 }, { port: 2, target_type: "odc", target_odc_id: 2, target_odc_splitter_id: 5 }] },
      { id: 4, odc_id: 2, name: "SPL-ANAK-A", ratio: "1:8", input_core: 1, outputs: [{ port: 1, target_type: "odp", target_odp_id: 3 }] },
      { id: 5, odc_id: 2, name: "SPL-ANAK-B", ratio: "1:8", input_core: 1, outputs: [{ port: 1, target_type: "odp", target_odp_id: 4 }] },
      { id: 6, odc_id: 3, name: "SPL-OLT-LAIN", ratio: "1:8", input_core: 1, outputs: [{ port: 1, target_type: "odp", target_odp_id: 6 }] },
    ],
    links: [
      { id: 1, odc_id: 1, odc_core: 7, odp_id: 5, odp_core: 2, notes: "Sambungan tray 7" },
      { id: 2, odc_id: 1, odc_core: 9, odp_id: 8, odp_core: 1 },
    ],
    cores: [],
  };
}
