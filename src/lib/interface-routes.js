// Penelusuran berdasarkan sambungan, bukan keanggotaan kabinet.
// Port feeder yang terdaftar di ODC BELUM berarti setiap core berasal darinya.
import { colorForCoreInCable, coresPerTube, splitterPorts } from "./fiber.js";
import { interfaceDetails, interfaceLabel, sortInterfaces } from "./interfaces.js";

export function directInputSplitters(splitters = []) {
  const received = new Set();
  for (const s of splitters) for (const o of s.outputs || []) {
    if (o.target_type === "splitter" && o.target_splitter_id) received.add(Number(o.target_splitter_id));
    if (o.target_type === "odc" && o.target_odc_splitter_id) received.add(Number(o.target_odc_splitter_id));
  }
  return splitters.filter((s) => s.odc_id != null && !received.has(Number(s.id)));
}

// Satu core pada kabel feeder langsung hanya memiliki satu tujuan input pertama.
export function feederInputUsage({ splitters = [], links = [] } = {}) {
  const usage = new Map();
  const add = (odcId, core) => {
    if (core == null || core === "") return;
    const key = `${Number(odcId)}:${Number(core)}`;
    usage.set(key, (usage.get(key) || 0) + 1);
  };
  directInputSplitters(splitters).forEach((s) => add(s.odc_id, s.input_core));
  links.forEach((l) => add(l.odc_id, l.odc_core));
  return usage;
}

export function buildInterfaceRoutes({ olts = [], ports = [], odcs = [], odps = [], splitters = [], links = [], cores = [], feederPorts = [], interfaceMappings = [] } = {}) {
  const oltById = new Map(olts.map((o) => [Number(o.id), o]));
  const odcById = new Map(odcs.map((o) => [Number(o.id), o]));
  const odpById = new Map(odps.map((o) => [Number(o.id), o]));
  const splById = new Map(splitters.map((s) => [Number(s.id), s]));
  const portById = new Map(sortInterfaces(ports).map((p) => [Number(p.id), { ...p, ...interfaceDetails(p, { ...oltById.get(Number(p.olt_id)), ...p }) }]));
  const cascadeInputs = new Set(splitters.flatMap((s) => (s.outputs || []).filter((o) => o.target_type === "splitter").map((o) => Number(o.target_splitter_id))));
  const groupById = new Map();
  const inputUsage = feederInputUsage({ splitters, links });
  const odpOrigins = new Map();
  const splitterOrigins = new Map();
  const visitedOdcs = new Set();

  function groupFor(odcId, core, suffix = "") {
    const odc = odcById.get(Number(odcId));
    if (!odc) return null;
    const n = core == null || core === "" ? null : Number(core);
    const id = `${odc.id}:${n ?? `unknown-${suffix}`}`;
    if (!groupById.has(id)) {
      const mapping = n == null ? null : interfaceMappings.find((m) => Number(m.odc_id) === Number(odc.id) && Number(m.core) === n);
      const candidate = mapping?.port_id ? portById.get(Number(mapping.port_id)) : null;
      const inputConflict = (inputUsage.get(`${Number(odc.id)}:${n}`) || 0) > 1;
      const valid = !inputConflict && candidate && Number(candidate.olt_id) === Number(odc.olt_id)
        && feederPorts.some((f) => Number(f.odc_id) === Number(odc.id) && Number(f.port_id) === Number(candidate.id));
      const port = valid ? candidate : null;
      groupById.set(id, { id, odc, core: n, port, mapping, inputConflict, olt: oltById.get(Number(port?.olt_id ?? odc.olt_id)), trees: [], directLinks: [], odpIds: new Set(), odcIds: new Set([Number(odc.id)]) });
    }
    visitedOdcs.add(Number(odc.id));
    return groupById.get(id);
  }

  const stopped = (port, note) => ({ kind: "terputus", port, note });
  function walkOdp(odpId, port, depth, seen, inputCore = null) {
    const odp = odpById.get(Number(odpId));
    const key = `odp:${odpId}`;
    if (seen.has(key) || depth > 32) return stopped(port, "Penelusuran berhenti: alur ODP berputar atau terlalu dalam");
    const next = new Set(seen).add(key);
    const inside = splitters.filter((s) => Number(s.odp_id) === Number(odpId) && s.odp_id != null);
    const matched = inputCore == null ? [] : inside.filter((s) => !cascadeInputs.has(Number(s.id)) && s.input_core != null && Number(s.input_core) === Number(inputCore));
    return {
      kind: "odp", port, odpId: Number(odpId), name: odp?.name ?? "ODP tidak ditemukan",
      location: odp?.location, odcName: odp?.odc_name ?? odcById.get(Number(odp?.odc_id))?.name,
      cableType: odp?.cable_type, inputCore,
      powerCores: cores.filter((c) => c.source === "odc_to_odp" && Number(c.odp_id) === Number(odpId)).map((c) => ({ core: Number(c.core), status: c.status ?? "idle" })),
      insideSplitters: inside.map((s) => ({ id: s.id, name: s.name, ratio: s.ratio })),
      // Isi ODP bukan bukti sumber setiap splitter di dalamnya. Hanya lanjut
      // jika core masuk ODP diketahui dan cocok dengan input splitter.
      insideTrees: matched.length === 1 ? matched.map((s) => walkSplitter(s, null, depth + 1, next)) : [],
    };
  }

  function walkSplitter(s, viaPort, depth, seen) {
    const key = `spl:${s.id}`;
    if (seen.has(key) || depth > 32) return stopped(viaPort, "Penelusuran berhenti: alur splitter berputar atau terlalu dalam");
    const next = new Set(seen).add(key);
    const children = [];
    const outputs = [...(s.outputs || [])].sort((a, b) => Number(a.port) - Number(b.port));
    for (const o of outputs) {
      if (o.target_type === "odp" && o.target_odp_id) {
        children.push(walkOdp(o.target_odp_id, o.port, depth + 1, next));
      } else if (o.target_type === "splitter" && o.target_splitter_id) {
        const target = splById.get(Number(o.target_splitter_id));
        children.push(target ? walkSplitter(target, o.port, depth + 1, next) : stopped(o.port, "Splitter tujuan tidak ditemukan"));
      } else if (o.target_type === "odc" && o.target_odc_id) {
        const odc = odcById.get(Number(o.target_odc_id));
        const receiver = splById.get(Number(o.target_odc_splitter_id));
        // Nomor/warna core tidak menentukan receiver: hanya ID splitter eksplisit.
        const validReceiver = receiver && Number(receiver.odc_id) === Number(o.target_odc_id);
        const odcKey = `odc:${o.target_odc_id}`;
        const cycle = next.has(odcKey) || depth > 32;
        children.push({ kind: "odc", port: o.port, odcId: Number(o.target_odc_id), name: odc?.name ?? "ODC tidak ditemukan", location: odc?.location,
          splitterName: validReceiver ? receiver.name : null,
          core: validReceiver ? receiver.input_core : o.target_odc_core,
          cableType: odc?.cable_type,
          children: cycle ? [stopped(null, "Penelusuran berhenti: jalur ODC berputar")]
            : validReceiver ? [walkSplitter(receiver, null, depth + 1, new Set(next).add(odcKey))] : [],
        });
      }
    }
    return { kind: "splitter", id: Number(s.id), name: s.name, ratio: s.ratio, odcId: s.odc_id, viaPort,
      inputCore: viaPort == null ? s.input_core : null, children,
      idlePorts: Math.max(0, splitterPorts(s.ratio) - outputs.filter((o) => o.target_type).length),
    };
  }

  for (const s of directInputSplitters(splitters)) {
    const group = groupFor(s.odc_id, s.input_core, s.id);
    if (group) group.trees.push({ core: group.core, root: walkSplitter(s, null, 0, new Set([`odc:${s.odc_id}`])) });
  }
  for (const link of links) {
    const group = groupFor(link.odc_id, link.odc_core);
    if (group) group.directLinks.push({ ...link, odcCore: Number(link.odc_core), odpCore: Number(link.odp_core), odpId: Number(link.odp_id), odpName: odpById.get(Number(link.odp_id))?.name ?? link.odp_name,
      node: walkOdp(link.odp_id, null, 0, new Set([`odc:${link.odc_id}`]), Number(link.odp_core)) });
  }
  for (const m of interfaceMappings) groupFor(m.odc_id, m.core);

  function collect(node, group, steps) {
    const prefix = node.port != null || node.viaPort != null ? `out ${node.port ?? node.viaPort} → ` : "";
    if (node.kind === "terputus") return;
    const text = node.kind === "splitter" ? `${node.name} (${node.ratio})`
      : node.kind === "odc" && node.core != null ? `${node.name} · core ${node.core}` : node.name;
    const path = [...steps, { kind: node.kind, name: prefix + text }];
    if (node.kind === "splitter") {
      const origins = splitterOrigins.get(node.id) || [];
      origins.push({ port: group.port, olt: group.olt, text: path.map((s) => s.name).join(" → ") });
      splitterOrigins.set(node.id, origins);
    }
    if (node.kind === "odc") { group.odcIds.add(node.odcId); visitedOdcs.add(node.odcId); }
    if (node.kind === "odp") {
      group.odpIds.add(node.odpId);
      const origins = odpOrigins.get(node.odpId) ?? [];
      origins.push({ groupId: group.id, inputConflict: group.inputConflict, port: group.port, olt: group.olt, odc: group.odc, core: group.core, steps: path, text: path.map((s) => s.name).join(" → ") });
      odpOrigins.set(node.odpId, origins);
      for (const inside of node.insideTrees || []) collect(inside, group, path);
    }
    for (const child of node.children || []) collect(child, group, path);
  }
  const groups = [...groupById.values()].sort((a, b) => Number(a.olt?.id ?? 0) - Number(b.olt?.id ?? 0)
    || Number(a.port?.shelf ?? 999) - Number(b.port?.shelf ?? 999)
    || Number(a.port?.slot ?? 999) - Number(b.port?.slot ?? 999)
    || Number(a.port?.port ?? 999) - Number(b.port?.port ?? 999)
    || a.odc.name.localeCompare(b.odc.name, "id", { numeric: true }) || (a.core ?? 999) - (b.core ?? 999));
  for (const group of groups) {
    const color = group.core == null ? "" : colorForCoreInCable(group.core, coresPerTube(group.odc.cable_type)).name;
    const steps = [{ kind: "olt", name: group.olt?.name ?? "OLT belum diketahui" },
      { kind: "interface", name: interfaceLabel(group.port) },
      { kind: "odc", name: `${group.odc.name}${group.core != null ? ` · core ${group.core} ${color}` : " · core belum diisi"}` }];
    for (const tree of group.trees) collect(tree.root, group, steps);
    for (const link of group.directLinks) collect(link.node, group, [...steps, { kind: "core", name: `kabel langsung C${link.odcCore} → C${link.odpCore}` }]);
    const names = [];
    const addNames = (node) => {
      names.push(node.name, node.location, node.ratio, node.note);
      const core = node.core ?? node.inputCore;
      if (core != null) names.push(`core ${core}`, colorForCoreInCable(core, coresPerTube(node.cableType || group.odc.cable_type)).name);
      for (const c of node.powerCores || []) names.push(`core ${c.core}`, colorForCoreInCable(c.core, coresPerTube(node.cableType)).name);
      for (const child of [...(node.children || []), ...(node.insideTrees || [])]) addNames(child);
    };
    group.trees.forEach((t) => addNames(t.root));
    group.directLinks.forEach((l) => { addNames(l.node); names.push(l.notes, `core ${l.odpCore}`, colorForCoreInCable(l.odpCore, coresPerTube(l.node.cableType)).name); });
    group.searchText = [...steps.map((s) => s.name), group.port?.interface_cli, group.mapping?.notes, group.odc.location, ...names].filter(Boolean).join(" ").toLowerCase();
  }
  return { groups, odpOrigins, splitterOrigins,
    unconnectedOdps: odps.filter((o) => !odpOrigins.has(Number(o.id))),
    unconnectedOdcs: odcs.filter((o) => !visitedOdcs.has(Number(o.id))),
  };
}

export function filterInterfaceGroups(groups, { oltId = "", portId = "", query = "" } = {}) {
  const q = String(query).trim().toLowerCase();
  return groups.filter((g) => (!oltId || Number(g.olt?.id) === Number(oltId))
    && (!portId || (portId === "unmapped" ? !g.port : Number(g.port?.id) === Number(portId)))
    && (!q || g.searchText.includes(q)));
}
