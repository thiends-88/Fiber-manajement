// Konstanta untuk aplikasi manajemen fiber optik

export const CABLE_TYPES = [
  { value: "48_core_4_tube", label: "48 Core / 4 Tube", cores: 48, tubes: 4 },
  { value: "48_core_8_tube", label: "48 Core / 8 Tube", cores: 48, tubes: 8 },
  { value: "24_core_4_tube", label: "24 Core / 4 Tube", cores: 24, tubes: 4 },
  { value: "24_core_2_tube", label: "24 Core / 2 Tube", cores: 24, tubes: 2 },
  { value: "12_core_2_tube", label: "12 Core / 2 Tube", cores: 12, tubes: 2 },
  { value: "figure8_12_core", label: "Figure 8 - 12 Core", cores: 12, tubes: 1 },
  { value: "figure8_6_core", label: "Figure 8 - 6 Core", cores: 6, tubes: 1 },
] as const;

export type CableTypeValue = (typeof CABLE_TYPES)[number]["value"];

export function getCableInfo(value: string | null | undefined) {
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
] as const;

export function colorForCore(coreNumber: number) {
  // core 1..12 → warna 1..12, core 13..24 → tube-2 warna 1..12, dst.
  const idx = ((coreNumber - 1) % 12 + 12) % 12;
  return FIBER_COLORS[idx];
}

export function tubeForCore(coreNumber: number) {
  return Math.floor((coreNumber - 1) / 12) + 1;
}

// Jumlah core per tube untuk suatu jenis kabel
export function coresPerTube(cableType: string | null | undefined) {
  const info = getCableInfo(cableType);
  if (!info) return 12;
  return Math.ceil(info.cores / info.tubes);
}

// Warna core relatif terhadap tube-nya (urutan warna reset tiap tube)
export function colorForCoreInCable(coreNumber: number, perTube: number) {
  const n = perTube > 0 ? perTube : 12;
  const idxInTube = ((coreNumber - 1) % n + n) % n;
  return FIBER_COLORS[idxInTube % 12];
}

export function tubeForCoreInCable(coreNumber: number, perTube: number) {
  const n = perTube > 0 ? perTube : 12;
  return Math.floor((coreNumber - 1) / n) + 1;
}

// Warna tube mengikuti standar TIA/EIA-598 (urutan sama dengan warna core)
// Tube 1 = Biru, Tube 2 = Jingga, Tube 3 = Hijau, Tube 4 = Coklat, dst.
export function colorForTube(tubeNumber: number) {
  const idx = ((tubeNumber - 1) % 12 + 12) % 12;
  return FIBER_COLORS[idx];
}

export const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  idle: { label: "Idle", className: "bg-muted text-muted-foreground" },
  used: { label: "Terpakai", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  reserved: { label: "Reserved", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  damaged: { label: "Rusak", className: "bg-red-500/15 text-red-600 dark:text-red-400" },
};

// Pilihan jenis OLT populer (bebas ditambah lewat input "Lainnya")
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
] as const;

// Jenis card OLT + jumlah port default
export const CARD_TYPES = [
  { value: "GTGO", label: "GTGO (8 port GPON)", defaultPorts: 8 },
  { value: "GTGH", label: "GTGH (16 port GPON)", defaultPorts: 16 },
  { value: "GPFA", label: "GPFA (8 port GPON)", defaultPorts: 8 },
  { value: "GPBD", label: "GPBD (8 port GPON)", defaultPorts: 8 },
  { value: "OTHER", label: "Lainnya", defaultPorts: 8 },
] as const;

export type CardTypeValue = (typeof CARD_TYPES)[number]["value"];

export const PORT_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  active: { label: "Aktif", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  inactive: { label: "Non-aktif", className: "bg-muted text-muted-foreground" },
  reserved: { label: "Reserved", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  damaged: { label: "Rusak", className: "bg-red-500/15 text-red-600 dark:text-red-400" },
};
