// Perhitungan tata letak diagram topologi (murni, tanpa React) supaya bisa diuji.
// Alur: OLT → ODC → splitter (bisa bertingkat/cascade) → ODP → splitter di dalam ODP.

import { colorForCoreInCable, coresPerTube, getCableInfo } from "./fiber.js";

export const NODE_W = 176;
export const NODE_H = 58;
export const GAP_X = 68;
export const GAP_Y = 18;
export const MARGIN = 16;

export const EDGE_STYLE = {
  feeder: { color: "#22d3ee", label: "Feeder OLT → ODC" },
  feed: { color: "#8b5cf6", label: "Core masuk perangkat" },
  cascade: { color: "#a78bfa", label: "Cascade splitter" },
  out: { color: "#34d399", label: "Output splitter → ODP" },
  "splitter-odc": { color: "#38bdf8", label: "Output splitter → ODC anak" },
  core: { color: "#f59e0b", label: "Sambungan core (kabel)" },
  "core-empty": { color: "#64748b", label: "ODP belum dipetakan core" },
};

export const NODE_STYLE = {
  olt: { color: "#22d3ee", label: "OLT" },
  odc: { color: "#8b5cf6", label: "ODC" },
  odp: { color: "#f59e0b", label: "ODP" },
  spl: { color: "#a78bfa", label: "Splitter" },
};

const truncate = (s, n) => {
  const v = String(s ?? "");
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

export function buildTopologyGraph({
  olts = [],
  odcs = [],
  odps = [],
  splitters = [],
  links = [],
  feederPorts = [],
} = {}) {
  const nodes = [];
  const edges = [];
  const index = new Map();

  const addNode = (node) => {
    index.set(node.id, nodes.length);
    nodes.push(node);
  };
  const addEdge = (from, to, kind, label, color) => {
    if (!index.has(from) || !index.has(to)) return;
    edges.push({
      id: `${from}->${to}#${edges.length}`,
      from,
      to,
      kind,
      label: truncate(label, 22),
      color: color ?? EDGE_STYLE[kind]?.color ?? "#8b5cf6",
    });
  };

  // --- simpul ---
  olts.forEach((o) => addNode({ id: `olt-${o.id}`, kind: "olt", title: truncate(o.name, 20), sub: truncate(o.olt_type || "OLT", 24) }));
  odcs.forEach((d) =>
    addNode({
      id: `odc-${d.id}`,
      kind: "odc",
      title: truncate(d.name, 20),
      sub: truncate(getCableInfo(d.cable_type)?.label ?? d.cable_type ?? "ODC", 24),
    }),
  );
  odps.forEach((p) =>
    addNode({
      id: `odp-${p.id}`,
      kind: "odp",
      title: truncate(p.name, 20),
      sub: truncate(getCableInfo(p.cable_type)?.label ?? p.cable_type ?? "ODP", 24),
    }),
  );
  splitters.forEach((s) => {
    const outputs = s.outputs || [];
    const used = outputs.filter((o) => o.target_type).length;
    addNode({
      id: `spl-${s.id}`,
      kind: "spl",
      title: truncate(s.name, 20),
      sub: `${s.ratio} · ${used}/${outputs.length} output`,
    });
  });

  // --- sisi (edges) ---
  // ODC yang menerima suplai dari output splitter ODC lain (jadi ODC anak)
  const childOdcIds = new Set(
    splitters.flatMap((s) => (s.outputs ?? []).filter((o) => o.target_type === "odc" && o.target_odc_id).map((o) => Number(o.target_odc_id))),
  );

  // --- warna core mengalir ---
  // Splitter yang diumpan core kabel (input_core) mewariskan core itu ke splitter
  // cascade-nya HANYA dalam ODC yang sama. Warna garis = warna core di kabel ODC asal.
  const odcById = new Map(odcs.map((d) => [Number(d.id), d]));
  const hasOdc = (s) => s.odc_id != null && s.odc_id !== "";
  const hasCore = (v) => v != null && v !== "";
  const parentsOf = new Map(); // id splitter tujuan cascade -> daftar splitter induk
  [...splitters]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .forEach((p) => {
      (p.outputs ?? []).forEach((o) => {
        if (o.target_type === "splitter" && o.target_splitter_id) {
          const tid = Number(o.target_splitter_id);
          if (!parentsOf.has(tid)) parentsOf.set(tid, []);
          parentsOf.get(tid).push(p);
        }
      });
    });
  const feedCache = new Map();
  const feedBusy = new Set();
  // feed = { odcId, core } atau null (tidak diketahui → warna bawaan)
  const feedOf = (s) => {
    if (!s || !hasOdc(s)) return null;
    const sid = Number(s.id);
    if (feedCache.has(sid)) return feedCache.get(sid);
    if (feedBusy.has(sid)) return null; // pengaman bila cascade membentuk lingkaran
    feedBusy.add(sid);
    let feed = null;
    if (hasCore(s.input_core)) {
      feed = { odcId: Number(s.odc_id), core: Number(s.input_core) };
    } else {
      for (const p of parentsOf.get(sid) ?? []) {
        const f = feedOf(p);
        if (f && f.odcId === Number(s.odc_id)) {
          feed = f;
          break;
        }
      }
    }
    feedBusy.delete(sid);
    feedCache.set(sid, feed);
    return feed;
  };
  const colorOfFeed = (f) => {
    const d = f ? odcById.get(f.odcId) : null;
    return d ? colorForCoreInCable(f.core, coresPerTube(d.cable_type)).hex : undefined;
  };
  // core masuk tiap ODP: odpId -> Map(kunci -> entri)
  const coreInByOdp = new Map();
  const pushCoreIn = (odpId, f, port) => {
    const d = odcById.get(f.odcId);
    if (!d) return;
    const c = colorForCoreInCable(f.core, coresPerTube(d.cable_type));
    const key = `${f.odcId}:${f.core}:${port ?? "-"}`;
    if (!coreInByOdp.has(odpId)) coreInByOdp.set(odpId, new Map());
    const m = coreInByOdp.get(odpId);
    if (!m.has(key)) {
      m.set(key, {
        odcId: f.odcId,
        odcName: d.name ?? `ODC ${f.odcId}`,
        core: f.core,
        hex: c.hex,
        colorName: c.name,
        port: port ?? null,
      });
    }
  };

  // OLT → ODC: gambar bila ODC punya port feeder, atau memang bukan ODC anak
  odcs.forEach((d) => {
    const fp = feederPorts.filter((f) => f.odc_id === d.id);
    if (fp.length === 0 && childOdcIds.has(d.id)) return; // sudah digambar sebagai cabang ODC induk
    const label = fp.length ? fp.map((f) => `p${f.port}`).join(",") : "feeder -";
    addEdge(`olt-${d.olt_id}`, `odc-${d.id}`, "feeder", label);
  });
  // perangkat → splitter
  // Splitter yang diumpan lewat CASCADE tidak digambar menerima core langsung
  // dari ODC: di lapangan ia disambung dari output splitter induknya, bukan
  // dari core kabel. Garis cascade sudah menunjukkan asal core-nya (ikut
  // berwarna). Splitter tanpa induk tetap digambar ke ODC agar tidak mengambang.
  splitters.forEach((s) => {
    const f = feedOf(s);
    const label = hasCore(s.input_core) ? `core ${s.input_core}` : f ? `core ${f.core}` : "core belum diisi";
    const punyaInduk = (parentsOf.get(Number(s.id)) ?? []).length > 0;
    if (s.odc_id) {
      if (hasCore(s.input_core) || !punyaInduk) {
        addEdge(`odc-${s.odc_id}`, `spl-${s.id}`, "feed", label, colorOfFeed(f));
      }
    } else if (s.odp_id) {
      addEdge(`odp-${s.odp_id}`, `spl-${s.id}`, "feed", label);
    }
  });
  // output splitter → ODP / cascade
  splitters.forEach((s) => {
    const f = feedOf(s);
    const color = colorOfFeed(f);
    (s.outputs || []).forEach((o) => {
      if (o.target_type === "splitter" && o.target_splitter_id) {
        addEdge(`spl-${s.id}`, `spl-${o.target_splitter_id}`, "cascade", `out ${o.port}`, color);
      } else if (o.target_type === "odp" && o.target_odp_id) {
        addEdge(`spl-${s.id}`, `odp-${o.target_odp_id}`, "out", `out ${o.port}`, color);
        if (f) pushCoreIn(Number(o.target_odp_id), f, o.port);
      } else if (o.target_type === "odc" && o.target_odc_id) {
        addEdge(`spl-${s.id}`, `odc-${o.target_odc_id}`, "splitter-odc", `out ${o.port}`, color);
      }
    });
  });
  // sambungan core ODC → ODP (warna mengikuti standar TIA/EIA-598)
  links.forEach((l) => {
    const odc = odcById.get(Number(l.odc_id));
    const color = odc ? colorForCoreInCable(l.odc_core, coresPerTube(odc.cable_type)).hex : undefined;
    addEdge(`odc-${l.odc_id}`, `odp-${l.odp_id}`, "core", `C${l.odc_core}→C${l.odp_core}`, color);
    if (odc) pushCoreIn(Number(l.odp_id), { odcId: Number(l.odc_id), core: Number(l.odc_core) }, null);
  });
  // daftar core masuk per ODP (diurutkan, tanpa duplikat)
  nodes.forEach((n) => {
    if (n.kind !== "odp") return;
    const m = coreInByOdp.get(Number(n.id.replace("odp-", ""))) ?? new Map();
    n.coreIn = [...m.values()].sort(
      (a, b) => a.odcId - b.odcId || a.core - b.core || (a.port ?? 0) - (b.port ?? 0),
    );
  });

  // ODP yang belum punya sambungan core tetap ditautkan ke ODC induknya
  // (garis putus-putus) supaya tampil di kolom yang benar, bukan di kolom OLT.
  odps.forEach((p) => {
    const already = edges.some((e) => e.to === `odp-${p.id}`);
    if (!already && index.has(`odc-${p.odc_id}`)) {
      addEdge(`odc-${p.odc_id}`, `odp-${p.id}`, "core-empty", "belum dipetakan");
    }
  });

  // --- relasi ---
  const incoming = new Map();
  const outgoing = new Map();
  edges.forEach((e) => {
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push(e);
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from).push(e);
  });

  // --- kedalaman kolom (jalur terpanjang dari akar) ---
  const depth = new Map();
  const visiting = new Set();
  const depthOf = (id) => {
    if (depth.has(id)) return depth.get(id);
    if (visiting.has(id)) return 0; // pengaman bila data membentuk lingkaran
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const d = parents.length ? Math.max(...parents.map((e) => depthOf(e.from) + 1)) : 0;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => depthOf(n.id));
  nodes.forEach((n) => {
    n.depth = depth.get(n.id) ?? 0;
  });

  const maxDepth = nodes.length ? Math.max(...nodes.map((n) => n.depth)) : 0;
  const columns = Array.from({ length: maxDepth + 1 }, () => []);
  nodes.forEach((n) => columns[n.depth].push(n));

  // urutkan tiap kolom agar dekat dengan induknya (mengurangi garis bersilangan)
  const orderKey = new Map(nodes.map((n, i) => [n.id, i]));
  for (let d = 1; d <= maxDepth; d++) {
    columns[d].sort((a, b) => {
      const ka = Math.min(...(incoming.get(a.id) ?? []).map((e) => orderKey.get(e.from) ?? 0), Number.MAX_SAFE_INTEGER);
      const kb = Math.min(...(incoming.get(b.id) ?? []).map((e) => orderKey.get(e.from) ?? 0), Number.MAX_SAFE_INTEGER);
      return ka - kb || (orderKey.get(a.id) ?? 0) - (orderKey.get(b.id) ?? 0);
    });
  }

  // --- koordinat ---
  columns.forEach((col, d) => {
    let y = MARGIN;
    col.forEach((n) => {
      n.x = MARGIN + d * (NODE_W + GAP_X);
      n.y = y;
      y += NODE_H + GAP_Y;
    });
  });

  const width = MARGIN * 2 + (maxDepth + 1) * NODE_W + maxDepth * GAP_X;
  const tallest = columns.reduce((m, col) => Math.max(m, col.length * (NODE_H + GAP_Y) - GAP_Y), 0);
  const height = Math.max(NODE_H + MARGIN * 2, tallest + MARGIN * 2);

  // --- geometri sisi ---
  edges.forEach((e) => {
    e.dashed = e.kind === "core-empty";
    const a = nodes[index.get(e.from)];
    const b = nodes[index.get(e.to)];
    e.x1 = a.x + NODE_W;
    e.y1 = a.y + NODE_H / 2;
    e.x2 = b.x;
    e.y2 = b.y + NODE_H / 2;
    const dx = Math.max(28, (e.x2 - e.x1) / 2);
    e.path = `M ${e.x1} ${e.y1} C ${e.x1 + dx} ${e.y1}, ${e.x2 - dx} ${e.y2}, ${e.x2} ${e.y2}`;
    e.mx = (e.x1 + e.x2) / 2;
    e.my = (e.y1 + e.y2) / 2 - 4;
  });

  return {
    nodes,
    edges,
    incoming,
    outgoing,
    columns,
    maxDepth,
    width,
    height,
    stats: {
      olts: olts.length,
      odcs: odcs.length,
      odps: odps.length,
      splitters: splitters.length,
      links: links.length,
      edges: edges.length,
    },
  };
}

/**
 * Telusuri alur core ke HULU dari sebuah simpul: dari mana core ini berasal,
 * langkah demi langkah sampai ke sumbernya (biasanya port OLT).
 *
 *   OLT-PST-01 → ODC-001 → SPL-1 (1:4) → SPL-2 (1:8) → ODP-003
 *
 * Berguna untuk menjawab pertanyaan teknisi "core ini datang dari mana?"
 * tanpa harus menelusuri garis di diagram. Fungsi murni supaya bisa diuji.
 *
 * @returns {Array<{langkah: Array<{node, edge}>, lengkap: boolean}>}
 *   tiap unsur = satu jalur hulu, urut dari sumber ke simpul yang ditanya.
 *   `lengkap: false` berarti jalur terpotong batas kedalaman (data berputar).
 */
export function buildUpstreamChains(graph, nodeId, { maxJalur = 6, maxKedalaman = 12 } = {}) {
  if (!graph || !nodeId) return [];
  const byId = new Map((graph.nodes ?? []).map((n) => [n.id, n]));
  const mulai = byId.get(nodeId);
  if (!mulai) return [];

  const hasil = [];
  const lihat = new Set();

  const telusuri = (id, jejak, kedalaman) => {
    if (hasil.length >= maxJalur) return;
    const masuk = graph.incoming?.get(id) ?? [];
    if (masuk.length === 0) {
      simpan(jejak, true);
      return;
    }
    if (kedalaman >= maxKedalaman) {
      simpan(jejak, false);
      return;
    }
    for (const e of masuk) {
      if (hasil.length >= maxJalur) return;
      const induk = byId.get(e.from);
      if (!induk) continue;
      telusuri(e.from, [{ node: induk, edge: e }, ...jejak], kedalaman + 1);
    }
  };

  function simpan(jejak, lengkap) {
    const kunci = jejak.map((j) => j.node.id).join(">");
    if (lihat.has(kunci)) return; // jalur kembar (data ganda) cukup sekali
    lihat.add(kunci);
    hasil.push({ langkah: jejak, lengkap });
  }

  telusuri(nodeId, [{ node: mulai, edge: null }], 0);
  return hasil;
}
