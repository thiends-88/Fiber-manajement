// Penelusuran baca-saja dari ODP ke hulu berdasarkan ID/receiver eksplisit.
// Tidak menebak jalur dari nama, GPS, induk inventaris atau kesamaan warna core.
import { colorForCoreInCable, coresPerTube, getCableInfo, splitterPorts, tubeForCoreInCable } from "./fiber.js";
import { feederInputUsage } from "./interface-routes.js";
import { interfaceDetails, interfaceLabel, interfaceLink } from "./interfaces.js";

const id = value => /^(?:[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const named = (row, fallback) => String(row?.name || fallback);
const group = (rows, key) => {
  const result = new Map();
  for (const row of rows) {
    const k = key(row);
    if (k != null) {
      if (!result.has(k)) result.set(k, []);
      result.get(k).push(row);
    }
  }
  return result;
};
export function describeCore(core, cableType) {
  const n = id(core), info = getCableInfo(cableType);
  if (!n || !info || n > info.cores) return null;
  const perTube = coresPerTube(cableType), color = colorForCoreInCable(n, perTube);
  return { number: n, color: color.name, hex: color.hex, tube: tubeForCoreInCable(n, perTube) };
}
const partial = (steps, issue, status = "partial") => ({ steps, issues: [issue], status, olt: null, port: null });
const append = (route, step) => ({ ...route, steps: [...route.steps, step] });
const review = (route, issue) => ({ ...route, status: "review", issues: [...route.issues, issue] });

export function buildOdpConnections(data = {}, odpId) {
  const { olts = [], odcs = [], odps = [], ports = [], splitters = [], links = [], feederPorts = [], interfaceMappings = [], cores = [] } = data;
  const index = rows => new Map(rows.filter(r => id(r.id)).map(r => [Number(r.id), r]));
  const oltById = index(olts), odcById = index(odcs), odpById = index(odps), portById = index(ports);
  const odp = odpById.get(id(odpId));
  if (!odp) return null;
  const inventoryOdc = odcById.get(id(odp.odc_id)), inventoryOlt = oltById.get(id(inventoryOdc?.olt_id));
  const incomingOdp = new Map(), incomingSplitter = new Map();
  const add = (map, key, value) => {
    const n = id(key);
    if (n) { if (!map.has(n)) map.set(n, []); map.get(n).push(value); }
  };
  for (const link of links) add(incomingOdp, link.odp_id, { link });
  for (const s of splitters) for (const output of s.outputs || []) {
    const edge = { s, output };
    // Catat juga referensi konflik agar receiver tidak valid tidak diam-diam
    // diubah menjadi asumsi feeder langsung dari OLT.
    add(incomingOdp, output.target_odp_id, edge);
    add(incomingSplitter, output.target_splitter_id, edge);
    add(incomingSplitter, output.target_odc_splitter_id, edge);
  }
  const mappingByCore = group(interfaceMappings, m => `${Number(m.odc_id)}:${Number(m.core)}`);
  const mappingByPort = group(interfaceMappings, m => id(m.port_id));
  const usage = feederInputUsage({ splitters, links });
  const warnings = [];
  let visits = 0, truncated = false;
  const LIMIT = 24, MAX_DEPTH = 32;
  function bounded(rows) {
    if (rows.length > LIMIT) truncated = true;
    return rows.slice(0, LIMIT);
  }
  function enter(key, seen, depth) {
    if (seen.has(key)) return "Jalur berputar; penelusuran dihentikan. Periksa Mapping Core.";
    if (depth > MAX_DEPTH || ++visits > 512) {
      truncated = true;
      return "Batas penelusuran tercapai; lanjutkan pemeriksaan di Mapping Core.";
    }
    return null;
  }
  const deviceStep = (kind, row, core = null) => ({
    kind, id: Number(row.id), label: named(row, kind.toUpperCase()), core: describeCore(core, row.cable_type),
    href: `/${kind}?${kind}=${encodeURIComponent(row.id)}`,
  });
  const splStep = (s, inputCore = null) => ({ kind: "splitter", id: Number(s.id), label: named(s, "Splitter"), ratio: s.ratio, core: inputCore });
  function owner(s) {
    if (id(s.odc_id) && s.odp_id == null) return { kind: "odc", record: odcById.get(Number(s.odc_id)) };
    if (id(s.odp_id) && s.odc_id == null) return { kind: "odp", record: odpById.get(Number(s.odp_id)) };
    return null;
  }
  function validOutput(s, o) {
    const targets = [["odp", o.target_odp_id], ["odc", o.target_odc_id], ["splitter", o.target_splitter_id]].filter(([, n]) => n != null);
    return targets.length === 1 && targets[0][0] === o.target_type && id(targets[0][1]) &&
      id(o.port) && Number(o.port) <= splitterPorts(s.ratio) &&
      (s.outputs || []).filter(x => Number(x.port) === Number(o.port)).length === 1 &&
      (o.target_type === "odc" || o.target_odc_splitter_id == null);
  }
  function validLink(l) {
    const d = odcById.get(id(l.odc_id)), p = odpById.get(id(l.odp_id));
    return d && p && Number(p.odc_id) === Number(d.id) && describeCore(l.odc_core, d.cable_type) && describeCore(l.odp_core, p.cable_type);
  }
  function feeder(odcId, core) {
    const d = odcById.get(id(odcId));
    if (!d) return partial([], "ODC sumber tidak ditemukan.", "review");
    const step = deviceStep("odc", d, core), n = describeCore(core, d.cable_type);
    if (!n) return partial([step], "Core feeder ODC belum diisi atau di luar kapasitas kabel.");
    const key = `${d.id}:${n.number}`, mappings = mappingByCore.get(key) || [];
    if ((usage.get(key) || 0) > 1) return partial([step], "Core feeder ODC memiliki input ganda; interface asal belum dapat dikonfirmasi.", "review");
    if (!mappings.length) return partial([step], "Interface asal belum dipetakan untuk core feeder ODC ini.");
    if (mappings.length !== 1) return partial([step], "Mapping core feeder ganda; jangan memilih salah satu sumber secara otomatis.", "review");
    const p = portById.get(id(mappings[0].port_id)), olt = oltById.get(id(p?.olt_id));
    if (!p || !olt || Number(p.olt_id) !== Number(d.olt_id) ||
      !feederPorts.some(f => Number(f.odc_id) === Number(d.id) && Number(f.port_id) === Number(p.id)) ||
      (mappingByPort.get(Number(p.id)) || []).length !== 1) {
      return partial([step], "Mapping interface tidak valid, konflik, atau port feeder sudah terlepas. Periksa Mapping Core.", "review");
    }
    const port = { ...p, ...interfaceDetails(p, { ...olt, ...p }) };
    return { status: "mapped", issues: [], olt, port, steps: [
      { kind: "olt", id: Number(olt.id), label: named(olt, "OLT"), detail: olt.olt_type, href: `/olt?olt=${olt.id}` },
      { kind: "interface", id: Number(port.id), label: interfaceLabel(port), detail: port.interface_cli, href: interfaceLink(port) },
      step,
    ] };
  }
  function withOutput(route, s, output) {
    return { ...route, steps: route.steps.map((step, i) => i === route.steps.length - 1 && step.kind === "splitter" && step.id === Number(s.id)
      ? { ...step, output: Number(output.port) } : step) };
  }
  function walkSplitter(s, seen, depth) {
    const own = owner(s), step = splStep(s), key = `splitter:${s.id}`, stop = enter(key, seen, depth);
    if (stop) return [partial([step], stop, "review")];
    if (!own?.record) return [partial([step], "Induk splitter tidak valid atau perangkatnya tidak ditemukan.", "review")];
    const next = new Set(seen).add(key), incoming = incomingSplitter.get(Number(s.id)) || [];
    if (incoming.length) {
      const routes = [];
      for (const edge of bounded(incoming)) {
        const from = owner(edge.s), o = edge.output;
        const sameOwner = from?.record && from.kind === own.kind && Number(from.record.id) === Number(own.record.id);
        const valid = validOutput(edge.s, o) && (o.target_type === "splitter" ? sameOwner :
          o.target_type === "odc" && own.kind === "odc" && Number(o.target_odc_id) === Number(own.record.id) && Number(o.target_odc_splitter_id) === Number(s.id));
        if (!valid) {
          routes.push(partial([deviceStep(own.kind, own.record), step], "Receiver/cascade splitter tidak valid; sumber hulu tidak ditebak.", "review"));
          continue;
        }
        for (let route of walkSplitter(edge.s, next, depth + 1)) {
          route = withOutput(route, edge.s, o);
          if (o.target_type === "odc") route = append(route, deviceStep("odc", own.record, s.input_core));
          route = append(route, splStep(s, o.target_type === "odc" ? describeCore(s.input_core, own.record.cable_type) : null));
          if (o.target_type === "odc" && s.input_core != null && !describeCore(s.input_core, own.record.cable_type)) {
            route = review(route, "Core masuk receiver ODC di luar kapasitas kabel atau tipe kabelnya tidak dikenali.");
          }
          if (incoming.length > 1) route = review(route, "Splitter penerima dituju beberapa output; jalur perlu diverifikasi.");
          routes.push(route);
        }
      }
      return bounded(routes);
    }
    const input = describeCore(s.input_core, own.record.cable_type);
    if (own.kind === "odc") return [append(feeder(own.record.id, s.input_core), splStep(s, input))];
    if (!input) return [partial([deviceStep("odp", own.record), step], "Core masuk splitter ODP belum tercatat; sumber hulu belum dapat ditelusuri.")];
    const rootCount = splitters.filter(x => Number(x.odp_id) === Number(own.record.id) && x.odc_id == null &&
      Number(x.input_core) === input.number && !(incomingSplitter.get(Number(x.id)) || []).length).length;
    return walkOdp(own.record.id, input.number, next, depth + 1).map(route => {
      const result = append(route, splStep(s, input));
      return rootCount > 1 ? review(result, "Core masuk ODP dipakai beberapa input splitter; sumber cabang perlu diperiksa.") : result;
    });
  }
  function walkOdp(pId, inputCore, seen, depth) {
    const p = odpById.get(id(pId));
    if (!p) return [partial([], "ODP pada jalur tidak ditemukan.", "review")];
    const key = `odp:${p.id}`, step = deviceStep("odp", p, inputCore), stop = enter(key, seen, depth);
    if (stop) return [partial([step], stop, "review")];
    const next = new Set(seen).add(key), all = incomingOdp.get(Number(p.id)) || [];
    // Output splitter -> ODP tidak menyimpan nomor core tujuan. Jangan
    // menganggap core masuk itu sama dengan input splitter lokal/core feeder.
    const incoming = inputCore == null ? all : all.filter(e => e.link && Number(e.link.odp_core) === Number(inputCore));
    if (!incoming.length) return inputCore == null ? [] : [partial([step], all.length
      ? "Sambungan menuju ODP tercatat, tetapi core masuknya belum mengikat splitter ini; jalur tidak ditebak."
      : "Belum ada sambungan hulu menuju core ODP ini.")];
    const routes = [];
    for (const edge of bounded(incoming)) {
      if (edge.link) {
        const l = edge.link, d = odcById.get(id(l.odc_id));
        if (!validLink(l)) {
          routes.push(partial([...(d ? [deviceStep("odc", d, l.odc_core)] : []), step], "Sambungan kabel langsung tidak valid; periksa induk dan kapasitas core.", "review"));
          continue;
        }
        let route = feeder(l.odc_id, l.odc_core);
        route = append(route, { kind: "direct", id: Number(l.id), label: "Kabel langsung", detail: `Core ODC ${l.odc_core} → core ODP ${l.odp_core}` });
        route = append(route, deviceStep("odp", p, l.odp_core));
        if (all.filter(e => e.link && Number(e.link.odp_core) === Number(l.odp_core)).length > 1) {
          route = review(route, "Core masuk ODP dituju beberapa kabel langsung; sumbernya perlu diverifikasi.");
        }
        routes.push(route);
      } else {
        if (!validOutput(edge.s, edge.output)) {
          routes.push(partial([splStep(edge.s), step], "Output splitter menuju ODP tidak valid atau memiliki tujuan ganda.", "review"));
          continue;
        }
        for (const route of walkSplitter(edge.s, next, depth + 1)) routes.push(append(withOutput(route, edge.s, edge.output), step));
      }
    }
    return bounded(routes);
  }
  const rank = { mapped: 0, review: 1, partial: 2 };
  const routes = walkOdp(odp.id, null, new Set(), 0)
    .sort((a, b) => rank[a.status] - rank[b.status])
    .map((route, i) => ({ ...route, key: `odp-${odp.id}-route-${i}` }));
  const powers = new Map();
  function power(n) {
    const core = describeCore(n, odp.cable_type);
    if (!core) { warnings.push(`Core ODP ${String(n ?? "belum diisi")} tidak valid untuk tipe kabel ini.`); return null; }
    if (!powers.has(core.number)) powers.set(core.number, { ...core, records: [], usages: [] });
    return powers.get(core.number);
  }
  for (const c of cores.filter(c => c.source === "odc_to_odp" && Number(c.odp_id) === Number(odp.id))) power(c.core)?.records.push({ status: c.status, destination: c.destination, notes: c.notes });
  const localSplitters = splitters.filter(s => Number(s.odp_id) === Number(odp.id) && s.odc_id == null);
  for (const s of localSplitters) if (s.input_core != null && !(incomingSplitter.get(Number(s.id)) || []).length) power(s.input_core)?.usages.push(`Input ${named(s, "splitter")} (${s.ratio})`);
  for (const edge of incomingOdp.get(Number(odp.id)) || []) if (edge.link && validLink(edge.link)) power(edge.link.odp_core)?.usages.push(`Kabel langsung dari ${named(odcById.get(Number(edge.link.odc_id)), "ODC")} core ${edge.link.odc_core}`);
  for (const p of powers.values()) if (p.records.length > 1) warnings.push(`Ada beberapa catatan untuk core ODP ${p.number}; verifikasi statusnya.`);
  return { odp, inventoryOdc, inventoryOlt, routes, powerCores: [...powers.values()].sort((a, b) => a.number - b.number), localSplitters, warnings: [...new Set(warnings)], truncated };
}

// Ringkasan popup: core kabel ODP sendiri dan pasangan interface/ODC terakhir
// pada jalur sah. Induk inventaris tidak dipakai sebagai sumber pengganti.
export function summarizeOdpConnections(detail) {
  const sources = new Map();
  const mapped = detail.routes.filter(route => route.status === "mapped");
  const needsReview = detail.truncated || detail.routes.some(route => route.status === "review");
  for (const route of mapped) {
    const odc = route.steps.findLast(step => step.kind === "odc");
    if (!odc) continue;
    const port = route.port;
    const label = /^GPON \d+\/\d+\/\d+$/.test(port.interface_label) ? port.interface_code : port.interface_label;
    const key = `${route.olt.id}:${port.id}:${odc.id}`;
    sources.set(key, { key, interface: label, odcName: odc.label, oltName: route.olt.name });
  }
  if (!sources.size && !needsReview) {
    for (const route of detail.routes.filter(route => route.status === "partial")) {
      const odc = route.steps.findLast(step => step.kind === "odc");
      if (odc) sources.set(`unmapped-${odc.id}`, { key: `unmapped-${odc.id}`, interface: "Interface belum dipetakan", odcName: odc.label });
    }
  }
  if (!sources.size) sources.set("unknown", { key: "unknown", interface: needsReview ? "Asal perlu verifikasi" : "Interface / ODC asal belum dipetakan" });
  const notice = mapped.length && detail.routes.some(route => route.status !== "mapped")
    ? needsReview ? "Ada sambungan perlu verifikasi." : "Sebagian sambungan belum dipetakan."
    : detail.truncated ? "Penelusuran dibatasi; periksa Mapping Core." : "";
  return {
    name: detail.odp.name,
    cores: detail.powerCores.filter(core => core.usages.length || core.records.some(record => record.status === "used")),
    sources: [...sources.values()],
    notice,
  };
}
