// Identitas port fisik tetap memakai ID database. Format hanya mengatur nama
// yang dilihat teknisi; nomor interface yang sama boleh ada pada OLT berbeda.
export const INTERFACE_MODES = [
  { value: "shelf_slot_port", label: "Shelf / slot / port", hint: "ZTE C300/C320: GPON 1/1/1. Sesuaikan shelf, slot, dan jumlah port dengan card terpasang." },
  { value: "pon", label: "Port PON langsung", hint: "Untuk OLT fixed-port, misalnya HSGQ. Tampil PON 1, PON 2, dst.; tidak perlu menambah card." },
  { value: "custom", label: "Nama interface manual", hint: "Untuk penamaan lain. Isi nama persis sesuai perangkat, misalnya EPON0/1 atau gpon0/1." },
];

export function defaultInterfaceMode(oltType = "") {
  return /HSGQ|VSOL/i.test(oltType) ? "pon" : "shelf_slot_port";
}

export function interfaceMode(olt = {}) {
  return olt.interface_mode || defaultInterfaceMode(olt.olt_type);
}

export function interfaceDetails(port = {}, olt = port) {
  const mode = interfaceMode(olt);
  const code = mode === "shelf_slot_port"
    ? `${port.shelf ?? 1}/${port.slot ?? "?"}/${port.port ?? "?"}`
    : mode === "custom" ? port.interface_name?.trim() || "Nama belum diisi" : `${port.port ?? "?"}`;
  const label = mode === "shelf_slot_port" ? `GPON ${code}` : mode === "pon" ? `PON ${code}` : code;
  const cli = mode === "shelf_slot_port" && /ZTE C(?:300|320)\b/i.test(olt.olt_type || "")
    ? `gpon-olt_${code}` : mode === "custom" ? code : "";
  return { interface_code: code, interface_label: label, interface_cli: cli };
}

export function interfaceLabel(port) {
  return port?.interface_label || (port ? interfaceDetails(port).interface_label : "Interface asal belum dipetakan");
}

export function interfaceLink(port) {
  return `/?olt=${encodeURIComponent(port.olt_id)}&interface=${encodeURIComponent(port.port_id ?? port.id)}`;
}

export function sortInterfaces(ports) {
  return [...ports].sort((a, b) => Number(a.olt_id ?? 0) - Number(b.olt_id ?? 0)
    || Number(a.shelf ?? 1) - Number(b.shelf ?? 1)
    || Number(a.slot ?? 0) - Number(b.slot ?? 0)
    || Number(a.port ?? 0) - Number(b.port ?? 0));
}
