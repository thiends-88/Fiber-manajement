// Konstanta fiber optik — dipelajari dari aplikasi asli (src/lib/fiber.ts).

export const CABLE_TYPES = [
  { value: "48_core_8_tube", label: "48 Core / 8 Tube", cores: 48, tubes: 8 },
  { value: "48_core_4_tube", label: "48 Core / 4 Tube", cores: 48, tubes: 4 },
  { value: "24_core_4_tube", label: "24 Core / 4 Tube", cores: 24, tubes: 4 },
  { value: "24_core_2_tube", label: "24 Core / 2 Tube", cores: 24, tubes: 2 },
  { value: "12_core_2_tube", label: "12 Core / 2 Tube", cores: 12, tubes: 2 },
  { value: "figure8_12_core", label: "Figure 8 - 12 Core", cores: 12, tubes: 1 },
  { value: "figure8_6_core", label: "Figure 8 - 6 Core", cores: 6, tubes: 1 },
];

export function getCableInfo(value) {
  return CABLE_TYPES.find((c) => c.value === value) ?? null;
}

// Standar 12 warna fiber optik (TIA/EIA-598)
export const FIBER_COLORS = [
  { name: "Biru", hex: "#2563eb" },
  { name: "Jingga", hex: "#f97316" },
  { name: "Hijau", hex: "#16a34a" },
  { name: "Coklat", hex: "#78350f" },
  { name: "Abu-abu", hex: "#6b7280" },
  { name: "Putih", hex: "#f4f4f5" },
  { name: "Merah", hex: "#dc2626" },
  { name: "Hitam", hex: "#111827" },
  { name: "Kuning", hex: "#facc15" },
  { name: "Ungu", hex: "#8b5cf6" },
  { name: "Pink", hex: "#ec4899" },
  { name: "Aqua", hex: "#06b6d4" },
];

export function colorForCoreInCable(coreNumber, perTube) {
  const n = perTube > 0 ? perTube : 12;
  return FIBER_COLORS[((coreNumber - 1) % n + n) % n % 12];
}

export function tubeForCoreInCable(coreNumber, perTube) {
  const n = perTube > 0 ? perTube : 12;
  return Math.floor((coreNumber - 1) / n) + 1;
}

export function coresPerTube(cableType) {
  const info = getCableInfo(cableType);
  if (!info) return 12;
  return Math.ceil(info.cores / info.tubes);
}

export const STATUS = {
  idle: { label: "Idle", cls: "bg-slate-500/15 text-slate-300" },
  used: { label: "Terpakai", cls: "bg-emerald-500/15 text-emerald-400" },
  reserved: { label: "Reserved", cls: "bg-amber-500/15 text-amber-400" },
  damaged: { label: "Rusak", cls: "bg-red-500/15 text-red-400" },
};

export const PORT_STATUS = {
  active: { label: "Aktif", cls: "bg-emerald-500/15 text-emerald-400" },
  inactive: { label: "Non-aktif", cls: "bg-slate-500/15 text-slate-300" },
  reserved: { label: "Reserved", cls: "bg-amber-500/15 text-amber-400" },
  damaged: { label: "Rusak", cls: "bg-red-500/15 text-red-400" },
};

export const OLT_TYPES = [
  "ZTE C300",
  "ZTE C320",
  "ZTE C600",
  "ZTE C650",
  "Huawei MA5608T",
  "Huawei MA5680T",
  "Huawei MA5800",
  "HSGQ XPON",
  "Fiberhome AN5516",
  "VSOL V1600",
  "Lainnya",
];

export const CARD_TYPES = [
  { value: "GTGO", label: "GTGO (8 port GPON)", defaultPorts: 8 },
  { value: "GTGH", label: "GTGH (16 port GPON)", defaultPorts: 16 },
  { value: "GPFA", label: "GPFA (8 port GPON)", defaultPorts: 8 },
  { value: "GPBD", label: "GPBD (8 port GPON)", defaultPorts: 8 },
  { value: "OTHER", label: "Lainnya", defaultPorts: 8 },
];

// Sumber power perangkat lapangan
export const POWER_SOURCES = ["PLN", "Baterai", "PLN + Baterai", "Solar Hybrid"];
