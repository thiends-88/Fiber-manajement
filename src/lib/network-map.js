import { resolveCoordinates, coordinateText } from "./coordinates.js";
import { feederInputUsage } from "./interface-routes.js";
import { interfaceLabel } from "./interfaces.js";
import { getCableInfo } from "./fiber.js";

export const MAP_TYPES = {
  olt: { label: "OLT", color: "#38bdf8", path: "/olt", param: "olt" },
  odc: { label: "ODC", color: "#f59e0b", path: "/odc", param: "odc" },
  odp: { label: "ODP", color: "#34d399", path: "/odp", param: "odp" },
};
export const SCHEMATIC_NOTICE =
  "Garis koneksi skematis dari catatan sambungan, bukan rute kabel fisik/GPS atau ukuran panjang kabel.";
const numberId = (value) =>
  typeof value !== "boolean" &&
  /^(?:\d+)$/.test(String(value)) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) > 0;
const coreIn = (value, record) =>
  numberId(value) &&
  Number(value) <= (getCableInfo(record?.cable_type)?.cores || 0);
const natural = (a, b) =>
  String(a).localeCompare(String(b), "id", {
    numeric: true,
    sensitivity: "base",
  });

// Semua titik dipertahankan menurut ID, termasuk yang belum dipetakan/sama koordinat.
// Tidak membuat garis dari keanggotaan OLT/ODC atau kesamaan nomor/warna core.
export function buildNetworkMap(data = {}) {
  const {
    olts = [],
    odcs = [],
    odps = [],
    ports = [],
    splitters = [],
    links = [],
    feederPorts = [],
    interfaceMappings = [],
  } = data;
  const oltById = new Map(olts.map((row) => [Number(row.id), row]));
  const odcById = new Map(odcs.map((row) => [Number(row.id), row]));
  const odpById = new Map(odps.map((row) => [Number(row.id), row]));
  const splitterById = new Map(splitters.map((row) => [Number(row.id), row]));
  const portById = new Map(ports.map((row) => [Number(row.id), row]));
  const nodes = [],
    issues = [];
  for (const [kind, records] of [
    ["olt", olts],
    ["odc", odcs],
    ["odp", odps],
  ])
    for (const record of records) {
      if (!numberId(record.id)) {
        issues.push("Ada perangkat tanpa ID valid; tidak dapat dipetakan.");
        continue;
      }
      const odc =
        kind === "odp"
          ? odcById.get(Number(record.odc_id))
          : kind === "odc"
            ? record
            : null;
      const oltId =
        kind === "olt"
          ? Number(record.id)
          : odc?.olt_id == null
            ? null
            : Number(odc.olt_id);
      const olt = oltById.get(oltId);
      const coordinates = resolveCoordinates(record);
      const node = {
        key: `${kind}-${record.id}`,
        kind,
        id: Number(record.id),
        name: record.name || `${MAP_TYPES[kind].label} #${record.id}`,
        location: record.location || "",
        notes: record.notes || "",
        record,
        coordinates,
        oltId,
        odcId: odc?.id == null ? null : Number(odc.id),
        oltName: olt?.name || "Induk belum diketahui",
        odcName: odc?.name || "",
        link: `${MAP_TYPES[kind].path}?${MAP_TYPES[kind].param}=${encodeURIComponent(record.id)}`,
      };
      node.searchText = [
        node.name,
        node.location,
        node.oltName,
        node.odcName,
        MAP_TYPES[kind].label,
        coordinateText(coordinates),
      ]
        .join(" ")
        .toLowerCase();
      nodes.push(node);
    }
  nodes.sort(
    (a, b) =>
      Object.keys(MAP_TYPES).indexOf(a.kind) -
        Object.keys(MAP_TYPES).indexOf(b.kind) ||
      natural(a.name, b.name) ||
      a.id - b.id,
  );
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const connections = new Map();
  function add(fromKey, toKey, evidence, reviewReason = "") {
    const from = byKey.get(fromKey),
      to = byKey.get(toKey);
    if (!from || !to) {
      issues.push(`Sambungan ${evidence} kehilangan perangkat sumber/tujuan.`);
      return;
    }
    if (fromKey === toKey) return; // Cascade dalam kabinet bukan kabel antarlokasi.
    const key = `${fromKey}--${toKey}`;
    if (!connections.has(key))
      connections.set(key, {
        key,
        from,
        to,
        evidence: [],
        review: false,
        reviewReasons: [],
      });
    const connection = connections.get(key);
    if (!connection.evidence.includes(evidence))
      connection.evidence.push(evidence);
    connection.review ||= Boolean(reviewReason);
    if (reviewReason && !connection.reviewReasons.includes(reviewReason))
      connection.reviewReasons.push(reviewReason);
  }
  const usage = feederInputUsage({ splitters, links });
  const feeders = new Set(
    feederPorts.map((f) => `${Number(f.odc_id)}:${Number(f.port_id)}`),
  );
  const mappingPortCounts = new Map(),
    mappingCoreCounts = new Map(),
    receiverInputs = new Map();
  for (const m of interfaceMappings) {
    if (m.port_id != null)
      mappingPortCounts.set(
        Number(m.port_id),
        (mappingPortCounts.get(Number(m.port_id)) || 0) + 1,
      );
    const key = `${Number(m.odc_id)}:${Number(m.core)}`;
    mappingCoreCounts.set(key, (mappingCoreCounts.get(key) || 0) + 1);
  }
  for (const s of splitters)
    for (const out of s.outputs || []) {
      const id =
        out.target_type === "splitter"
          ? out.target_splitter_id
          : out.target_odc_splitter_id;
      if (id != null)
        receiverInputs.set(
          Number(id),
          (receiverInputs.get(Number(id)) || 0) + 1,
        );
    }
  for (const [id, count] of receiverInputs)
    if (count > 1)
      issues.push(
        `Receiver splitter #${id} dituju beberapa output. Verifikasi input; nomor/warna core tidak dipakai untuk menebak sumber.`,
      );
  for (const m of interfaceMappings) {
    const odc = odcById.get(Number(m.odc_id)),
      port = portById.get(Number(m.port_id));
    if (
      !odc ||
      !port ||
      !coreIn(m.core, odc) ||
      !oltById.has(Number(port.olt_id)) ||
      Number(odc.olt_id) !== Number(port.olt_id) ||
      !feeders.has(`${odc.id}:${port.id}`) ||
      (usage.get(`${odc.id}:${Number(m.core)}`) || 0) > 1 ||
      mappingPortCounts.get(Number(m.port_id)) > 1 ||
      mappingCoreCounts.get(`${odc.id}:${Number(m.core)}`) > 1
    ) {
      issues.push(
        `Mapping interface #${m.id} belum valid; sumber OLT tidak ditebak.`,
      );
      continue;
    }
    add(
      `olt-${port.olt_id}`,
      `odc-${odc.id}`,
      `${interfaceLabel(port)} [port #${port.id}; mapping #${m.id}] → core feeder ${m.core}${m.notes ? ` · ${m.notes}` : ""}`,
    );
  }
  for (const link of links) {
    const odc = odcById.get(Number(link.odc_id)),
      odp = odpById.get(Number(link.odp_id));
    if (
      !odc ||
      !odp ||
      Number(odp.odc_id) !== Number(odc.id) ||
      !coreIn(link.odc_core, odc) ||
      !coreIn(link.odp_core, odp)
    ) {
      issues.push(
        `Kabel langsung #${link.id} perlu diperiksa; garis tidak dibuat.`,
      );
      continue;
    }
    add(
      `odc-${odc.id}`,
      `odp-${odp.id}`,
      `Kabel langsung #${link.id}: core ${link.odc_core} → core ${link.odp_core}${link.notes ? ` · ${link.notes}` : ""}`,
    );
  }
  for (const splitter of splitters) {
    const owners = [
      splitter.odc_id != null ? `odc-${splitter.odc_id}` : null,
      splitter.odp_id != null ? `odp-${splitter.odp_id}` : null,
    ].filter(Boolean);
    if (owners.length !== 1 || !byKey.has(owners[0])) {
      issues.push(`Induk splitter #${splitter.id} tidak valid.`);
      continue;
    }
    for (const out of splitter.outputs || []) {
      const targets = [
        ["odp", out.target_odp_id],
        ["odc", out.target_odc_id],
        ["splitter", out.target_splitter_id],
      ].filter(([, id]) => id != null);
      if (!targets.length) continue;
      if (
        targets.length !== 1 ||
        (out.target_type && out.target_type !== targets[0][0])
      ) {
        issues.push(
          `Output #${out.id} memiliki tujuan konflik; garis tidak ditebak.`,
        );
        continue;
      }
      const [kind, id] = targets[0];
      const info = `${splitter.name || "Splitter"} [#${splitter.id}] / out ${out.port} [output #${out.id}]${out.notes ? ` · ${out.notes}` : ""}`;
      if (kind === "splitter") {
        const target = splitterById.get(Number(id));
        const same =
          target &&
          (target.odc_id != null
            ? `odc-${target.odc_id}`
            : `odp-${target.odp_id}`) === owners[0];
        if (!same)
          issues.push(
            `Cascade #${out.id} kehilangan receiver atau melintasi induk; verifikasi di Mapping Core.`,
          );
        continue;
      }
      let reviewReason = "",
        detail = info;
      if (kind === "odc") {
        const receiver = splitterById.get(Number(out.target_odc_splitter_id));
        if (
          !receiver ||
          receiver.odc_id == null ||
          receiver.odp_id != null ||
          Number(receiver.odc_id) !== Number(id)
        )
          reviewReason = "receiver belum dipilih/valid";
        else if ((receiverInputs.get(Number(receiver.id)) || 0) > 1)
          reviewReason = `receiver #${receiver.id} konflik: dituju beberapa output`;
        detail += receiver
          ? ` → ${receiver.name || "receiver"} [#${receiver.id}]`
          : "";
        if (reviewReason) detail += ` · ${reviewReason}`;
      }
      add(owners[0], `${kind}-${id}`, detail, reviewReason);
    }
  }
  const edges = [...connections.values()].map((edge) => ({
    ...edge,
    drawable:
      edge.from.coordinates.status === "valid" &&
      edge.to.coordinates.status === "valid",
  }));
  return { nodes, byKey, connections: edges, issues: [...new Set(issues)] };
}

export function filterNetworkMap(
  model,
  { oltId = "", odcId = "", kind = "", query = "" } = {},
) {
  const q = String(query).trim().toLowerCase();
  const nodes = model.nodes.filter(
    (node) =>
      (!oltId || String(node.oltId) === String(oltId)) &&
      (!odcId || String(node.odcId) === String(odcId)) &&
      (!kind || node.kind === kind) &&
      (!q || node.searchText.includes(q)),
  );
  const keys = new Set(nodes.map((n) => n.key));
  const connections = model.connections.filter(
    (edge) => keys.has(edge.from.key) && keys.has(edge.to.key),
  );
  return {
    nodes,
    points: nodes.filter((n) => n.coordinates.status === "valid"),
    missing: nodes.filter((n) => n.coordinates.status !== "valid"),
    connections,
    lines: connections.filter((edge) => edge.drawable),
    hiddenConnections: model.connections.filter(
      (edge) => keys.has(edge.from.key) !== keys.has(edge.to.key),
    ).length,
    unpositionedConnections: connections.filter((edge) => !edge.drawable)
      .length,
  };
}
