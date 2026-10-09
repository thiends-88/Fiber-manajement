// Peta jalur core per core ODC — murni, tanpa React, supaya bisa diuji
// langsung dengan node.
//
// buildCoreRoutes() membentuk POHON jalur untuk setiap core ODC yang masuk
// ke splitter (splitter.input_core = nomor core):
//
//   core ODC → splitter →
//     • output → cascade ke splitter lain   (kind "splitter", viaPort)
//     • output → ODP                        (kind "odp")
//     • output → ODC anak → splitter di dalamnya (kind "odc", children)
//     • output belum diarahkan → diringkas  (idlePorts)
//
// Sambungan kabel langsung (1 core ODC → 1 ODP, tanpa splitter) TIDAK ikut
// ke pohon — dikumpulkan terpisah di `directLinks` supaya bisa diberi label
// sendiri di tampilan.

import { splitterPorts } from "./fiber.js";

const MAX_DEPTH = 12; // pengaman bila data membentuk lingkaran

export function buildCoreRoutes({
  odcs = [],
  odps = [],
  splitters = [],
  links = [],
  cores = [],
  odcId = null,
} = {}) {
  const target = Number(odcId);
  if (!odcId || !Number.isFinite(target)) {
    return { odcId: null, trees: [], directLinks: [], stats: { cores: 0, directLinks: 0 } };
  }

  const splById = new Map(splitters.map((s) => [s.id, s]));

  // Akar pohon = splitter di ODC ini yang diumpan core kabel (input_core
  // terisi). Splitter tanpa input_core hanya bisa dicapai lewat cascade.
  // (Bila sebuah splitter sekaligus menjadi tujuan cascade — data abnormal —
  // pengaman `visitedSpl` di bawah mencegah loop tak hingga.)
  const akar = splitters
    .filter((s) => Number(s.odc_id) === target && s.input_core != null && s.input_core !== "")
    .sort((a, b) => Number(a.input_core) - Number(b.input_core) || a.id - b.id);

  // Data core feeder (status, daya) untuk ditempelkan ke pohon per core
  const feederByCore = new Map(
    cores
      .filter((c) => c.source === "olt_to_odc" && Number(c.odc_id) === target)
      .map((c) => [Number(c.core), c]),
  );

  function nodeOdp(o) {
    const id = Number(o.target_odp_id);
    const odp = odps.find((p) => p.id === id) ?? null;
    return {
      kind: "odp",
      port: o.port,
      odpId: id,
      name: odp?.name ?? o.target_odp_name ?? "ODP ?",
      location: odp?.location ?? null,
      cableType: odp?.cable_type ?? null,
      // Core milik kabel ODP sendiri yang dipakai sebagai POWER (output) ODP
      // itu — diambil dari grid core di form ODP (source "odc_to_odp").
      // Satu kabel bisa berlanjut OLT → ODC → ODP dengan core yang berbeda,
      // jadi warna core di ODP belum tentu sama dengan warna core dari ODC.
      powerCores: cores
        .filter((c) => c.source === "odc_to_odp" && Number(c.odp_id) === id)
        .map((c) => ({ core: Number(c.core), status: c.status ?? "idle" }))
        .sort((a, b) => a.core - b.core),
      insideSplitters: splitters
        .filter((s) => Number(s.odp_id) === id)
        .map((s) => ({ id: s.id, name: s.name, ratio: s.ratio })),
    };
  }

  function nodeOdcAnak(o, depth, visitedOdc, visitedSpl) {
    const id = Number(o.target_odc_id);
    const d = odcs.find((x) => x.id === id);
    const node = {
      kind: "odc",
      port: o.port,
      odcId: id,
      name: d?.name ?? o.target_odc_name ?? "ODC ?",
      children: [],
    };
    if (visitedOdc.has(id) || depth >= MAX_DEPTH) return node; // lingkaran → berhenti di sini
    visitedOdc.add(id);
    // Jalur berlanjut ke splitter di ODC anak yang diumpan core kabelnya
    node.children = splitters
      .filter((s) => Number(s.odc_id) === id && s.input_core != null && s.input_core !== "")
      .sort((a, b) => Number(a.input_core) - Number(b.input_core) || a.id - b.id)
      .map((s) => nodeSplitter(s, null, depth + 1, visitedOdc, visitedSpl));
    return node;
  }

  function nodeSplitter(s, viaPort, depth, visitedOdc, visitedSpl) {
    visitedSpl.add(s.id);
    const outs = [...(s.outputs ?? [])].sort((a, b) => (a.port ?? 0) - (b.port ?? 0));
    const children = [];
    let terarah = 0;
    for (const o of outs) {
      if (o.target_type === "splitter" && o.target_splitter_id) {
        terarah++;
        const nx = splById.get(Number(o.target_splitter_id));
        if (!nx) {
          children.push({ kind: "terputus", port: o.port, note: "splitter tujuan tidak ditemukan" });
        } else if (visitedSpl.has(nx.id) || depth >= MAX_DEPTH) {
          children.push({ kind: "terputus", port: o.port, note: `cascade berputar ke ${nx.name}` });
        } else {
          children.push(nodeSplitter(nx, o.port, depth + 1, visitedOdc, visitedSpl));
        }
      } else if (o.target_type === "odp" && o.target_odp_id) {
        terarah++;
        children.push(nodeOdp(o));
      } else if (o.target_type === "odc" && o.target_odc_id) {
        terarah++;
        children.push(nodeOdcAnak(o, depth, visitedOdc, visitedSpl));
      }
      // output tanpa target → dihitung sebagai idle (diringkas di tampilan)
    }
    const total = splitterPorts(s.ratio);
    const idlePorts = total > 0 ? Math.max(0, total - terarah) : outs.length - terarah;
    return {
      kind: "splitter",
      id: s.id,
      viaPort: viaPort ?? null,
      name: s.name,
      ratio: s.ratio,
      inputCore: s.input_core ?? null,
      odcId: s.odc_id ?? null,
      children,
      idlePorts,
    };
  }

  // Kunjungan (visited) DIBUAT PER POHON supaya dua core yang melewati
  // splitter yang sama tetap tergambar penuh di masing-masing pohon.
  const trees = akar.map((s) => {
    const visitedSpl = new Set();
    const visitedOdc = new Set([target]); // mencegah jalur berputar balik ke ODC terpilih
    return {
      core: Number(s.input_core),
      feeder: feederByCore.get(Number(s.input_core)) ?? null,
      root: nodeSplitter(s, null, 0, visitedOdc, visitedSpl),
    };
  });

  const directLinks = links
    .filter((l) => Number(l.odc_id) === target)
    .sort((a, b) => (a.odc_core ?? 0) - (b.odc_core ?? 0))
    .map((l) => {
      const odp = odps.find((p) => p.id === Number(l.odp_id));
      const namaOdp = l.odp_name ?? odp?.name ?? "ODP ?";
      return {
        linkId: l.id,
        odcCore: l.odc_core,
        odpId: l.odp_id,
        odpName: namaOdp,
        odpCore: l.odp_core,
        notes: l.notes || null,
        label: `Core ${l.odc_core} → ${namaOdp} core ${l.odp_core} (kabel langsung)`,
      };
    });

  return {
    odcId: target,
    trees,
    directLinks,
    stats: { cores: trees.length, directLinks: directLinks.length },
  };
}
