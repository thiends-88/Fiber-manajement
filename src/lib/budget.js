// Perhitungan anggaran daya (power budget) optik per jalur — murni, tanpa React
// supaya bisa diuji langsung dengan node.
//
//   Daya tiba = TX port OLT (dBm) − redaman kabel feeder − redaman splitter…
//
// Contoh: TX +7 dBm, topologi 4:8:8 (1:4 + 1:8 + 1:8 = 28,3 dB)
//         → 7 − 28,3 = −21,3 dBm di ujung (output splitter dalam ODP).

// Redaman khas splitter (dB) — nilai umum di pasaran, termasuk insertion loss
export const SPLITTER_LOSS = {
  "1:2": 3.6,
  "1:4": 7.3,
  "1:8": 10.5,
  "1:16": 13.8,
  "1:32": 17.0,
};

// Patokan GPON kelas B+ (paling umum di lapangan)
export const GPON = {
  sensitivity: -28, // daya minimum agar ONT masih bisa menerima
  overload: -8, // terlalu kuat → tidak stabil
  warnMargin: 3, // jarak ke sensitivitas yang dianggap rawan
};

export const splitterLoss = (ratio) => SPLITTER_LOSS[ratio] ?? null;

export function budgetStatus(dbm) {
  if (dbm === null || dbm === undefined || Number.isNaN(dbm)) {
    return { level: "unknown", label: "data belum lengkap", cls: "bg-slate-500/15 text-slate-300" };
  }
  if (dbm < GPON.sensitivity) {
    return { level: "fail", label: `gagal — di bawah ${GPON.sensitivity} dBm`, cls: "bg-red-500/15 text-red-400" };
  }
  if (dbm < GPON.sensitivity + GPON.warnMargin) {
    return { level: "warn", label: "mendekati batas", cls: "bg-amber-500/15 text-amber-300" };
  }
  if (dbm > GPON.overload) {
    return { level: "warn", label: "terlalu kuat (overload)", cls: "bg-amber-500/15 text-amber-300" };
  }
  return { level: "ok", label: "aman", cls: "bg-emerald-500/15 text-emerald-400" };
}

const num = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const r1 = (v) => Math.round(v * 10) / 10;
export const fmtDbm = (v) => (v === null ? "—" : `${r1(v)} dBm`);
export const fmtDb = (v) => `${r1(v)} dB`;

/**
 * Hitung anggaran daya untuk setiap ODP.
 * Mengembalikan array berisi rincian per ODP + status kelayakannya.
 */
export function buildPowerBudget({ olts = [], odcs = [], odps = [], splitters = [], links = [], feederPorts = [] } = {}) {
  const odcById = new Map(odcs.map((d) => [d.id, d]));
  const oltById = new Map(olts.map((o) => [o.id, o]));
  const splById = new Map(splitters.map((s) => [s.id, s]));

  // hubungan cascade: splitter anak → splitter induk
  const parentOf = new Map();
  splitters.forEach((s) =>
    (s.outputs ?? []).forEach((o) => {
      if (o.target_type === "splitter" && o.target_splitter_id) parentOf.set(o.target_splitter_id, s.id);
    }),
  );

  // Perjalanan ke hulu: dari sebuah splitter, telusuri induk cascade-nya
  const walkUp = (start) => {
    const chain = [];
    let cur = start ?? null;
    const guard = new Set();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      chain.unshift(cur);
      const pid = parentOf.get(cur.id);
      cur = pid ? splById.get(pid) ?? null : null;
    }
    return chain;
  };

  return odps.map((p) => {
    const odc = odcById.get(p.odc_id) ?? null;
    const olt = odc ? oltById.get(odc.olt_id) ?? null : null;
    const feeders = feederPorts.filter((f) => f.odc_id === p.odc_id);
    const feeder = feeders.find((f) => num(f.tx_power) !== null) ?? feeders[0] ?? null;
    const tx = feeder ? num(feeder.tx_power) : null;
    const txLabel = feeder
      ? `${olt?.name ?? "OLT"} ${feeder.card_label || `Card ${feeder.slot}`} port ${feeder.port}`
      : null;

    const feederLoss = num(odc?.feeder_loss_db) ?? 0;
    const inside = splitters.filter((s) => s.odp_id === p.id);

    // Jalur ke ODP:
    //  (a) output splitter DI LUAR ODP ini yang diarahkan ke ODP ini, atau
    //  (b) splitter di dalam ODP ini yang punya induk cascade (diumpankan dari luar)
    const externalEntry = splitters
      .filter((s) => s.odp_id !== p.id)
      .flatMap((s) => (s.outputs ?? []).map((o) => ({ s, o })))
      .find(({ o }) => o.target_type === "odp" && Number(o.target_odp_id) === p.id);

    let chain = [];
    if (externalEntry) {
      chain = walkUp(externalEntry.s);
    } else {
      const fed = inside.find((s) => parentOf.has(s.id));
      if (fed) chain = walkUp(splById.get(parentOf.get(fed.id)) ?? null);
    }

    const chainIds = new Set(chain.map((s) => s.id));
    const insideOnly = inside.filter((s) => !chainIds.has(s.id));
    const chainLoss = chain.reduce((sum, s) => sum + (splitterLoss(s.ratio) ?? 0), 0);
    const insideLoss = insideOnly.reduce((sum, s) => sum + (splitterLoss(s.ratio) ?? 0), 0);

    // jalur kabel langsung (sambungan core ODC → ODP) — dipakai bila tidak lewat splitter
    const cableLinks = links.filter((l) => l.odp_id === p.id);
    const cableLoss = cableLinks.reduce((m, l) => Math.max(m, num(l.loss_db) ?? 0), 0);

    const viaSplitter = chain.length > 0;
    const lineLoss = feederLoss + (viaSplitter ? chainLoss : cableLoss);
    const lossTotal = lineLoss + insideLoss;
    const routeKnown = viaSplitter || cableLinks.length > 0 || inside.length > 0;

    const arrival = tx === null ? null : tx - lineLoss; // daya tiba di ODP
    const finalOut = arrival === null ? null : arrival - insideLoss; // ujung terjauh
    const status = routeKnown
      ? budgetStatus(finalOut)
      : { level: "unknown", label: "jalur belum terdata", cls: "bg-slate-500/15 text-slate-300" };

    const routeParts = [
      txLabel ?? "OLT (port belum diisi)",
      odc?.name ?? "ODC ?",
      ...chain.map((s) => `${s.name} ${s.ratio}`),
      p.name,
      ...insideOnly.map((s) => `${s.name} ${s.ratio}`),
    ];

    return {
      odpId: p.id,
      odcId: odc?.id ?? null,
      odpName: p.name,
      odcName: odc?.name ?? "—",
      oltName: olt?.name ?? "—",
      txLabel,
      tx,
      feeders: feeders.length,
      feederLoss,
      chain: chain.map((s) => ({ id: s.id, name: s.name, ratio: s.ratio, loss: splitterLoss(s.ratio) })),
      chainLoss,
      insideSplitters: insideOnly.map((s) => ({ id: s.id, name: s.name, ratio: s.ratio, loss: splitterLoss(s.ratio) })),
      insideLoss,
      cableLoss,
      viaSplitter,
      routeKnown,
      lossTotal,
      arrival,
      finalOut,
      status,
      route: routeParts.join(" → "),
      topology: [...chain, ...insideOnly].map((s) => String(s.ratio).split(":")[1]).join(":"),
      links: cableLinks.length,
    };
  });
}
