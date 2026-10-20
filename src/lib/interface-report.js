// Laporan memakai mesin jalur yang sama dengan Alur Core. Daftar feeder ODC
// atau nomor interface yang kembar tidak dipakai untuk menebak sumber ODP.
import { buildInterfaceRoutes } from "./interface-routes.js";
import { interfaceDetails, interfaceLabel, sortInterfaces } from "./interfaces.js";
import { colorForCoreInCable, coresPerTube, tubeForCoreInCable, PORT_STATUS } from "./fiber.js";

export const INTERFACE_REPORT_COLUMNS = [
  "OLT", "Interface", "Nama CLI", "Status port (catatan manual)", "ODC feeder", "Core feeder", "Warna", "Tube",
  "Jalur lengkap", "ODP / ujung jalur", "Lokasi tujuan", "Kondisi jalur", "Catatan sambungan / feeder",
];

const natural = (a, b) => String(a).localeCompare(String(b), "id", { numeric: true, sensitivity: "base" });
const coreText = (group) => group.core == null ? "core belum diisi" : `core ${group.core} ${colorForCoreInCable(group.core, coresPerTube(group.odc.cable_type)).name}`;
const sourceReason = (group) => group.inputConflict
  ? "Input core ganda; sumber belum dapat dikonfirmasi"
  : group.core == null ? "Core input splitter belum diisi"
    : group.mapping?.port_id ? "Mapping sumber perlu diperiksa; port/feeder tidak valid" : "Interface asal belum dipetakan";

function routeRows(group) {
  const rows = [];
  const base = [group.olt?.name || "OLT belum diketahui", interfaceLabel(group.port), `${group.odc.name} / ${coreText(group)}`];
  const add = (key, path, target, location, condition, odpId = null, connectionNotes = "") => {
    rows.push({ key: `${group.id}/${key}`, groupId: group.id, odc: group.odc, core: group.core,
      color: group.core == null ? "" : colorForCoreInCable(group.core, coresPerTube(group.odc.cable_type)).name,
      tube: group.core == null ? null : tubeForCoreInCable(group.core, coresPerTube(group.odc.cable_type)),
      path: path.join(" → "), target, location: location || "", condition, odpId,
      notes: [group.mapping?.notes, connectionNotes].filter(Boolean).join(" / "), connectionNotes, sourceReason: group.port ? "" : sourceReason(group),
    });
  };
  function visit(node, path, key, connectionNotes = "") {
    const output = node.port ?? node.viaPort;
    const prefix = output == null ? "" : `out ${output} → `;
    if (node.kind === "terputus") {
      add(key, [...path, prefix + node.note], "Jalur perlu diperiksa", "", node.note, null, connectionNotes);
      return;
    }
    const label = node.kind === "splitter" ? `${node.name} (${node.ratio})`
      : node.kind === "odc" && node.core != null ? `${node.name} / core ${node.core}` : node.name;
    const next = [...path, prefix + label];
    if (node.kind === "odp") {
      add(key, next, node.name, node.location, "Sambungan ke ODP tercatat", node.odpId, connectionNotes);
      // Hanya insideTrees yang telah dipastikan cocok core masuknya oleh mesin
      // jalur. Inventaris splitter ODP saja tidak cukup untuk meneruskan sumber.
      (node.insideTrees || []).forEach((s, i) => visit(s, next, `${key}/inside-${i}`, connectionNotes));
      return;
    }
    if (node.kind === "odc" && !node.children.length) {
      add(key, next, node.name, node.location, node.splitterName ? "Jalur lanjutan ODC perlu diperiksa" : "Splitter penerima ODC belum dipilih", null, connectionNotes);
      return;
    }
    (node.children || []).forEach((child, i) => visit(child, next, `${key}/${i}`, connectionNotes));
    if (node.kind === "splitter" && node.idlePorts > 0) {
      add(`${key}/idle`, next, `${node.idlePorts} output belum diarahkan`, "", "Output splitter belum diarahkan", null, connectionNotes);
    } else if (node.kind === "splitter" && !node.children.length) {
      add(key, next, node.name, "", "Sambungan hilir belum dicatat", null, connectionNotes);
    }
  }
  group.trees.forEach((t, i) => visit(t.root, base, `tree-${i}`));
  group.directLinks.forEach((link, i) => visit(link.node, [...base, `kabel langsung C${link.odcCore} → C${link.odpCore}`], `direct-${i}`, link.notes));
  if (!rows.length) add("no-downstream", base, "Belum ada tujuan", "", group.port ? "Core feeder sudah dipetakan; sambungan hilir belum dicatat" : "Sambungan hilir belum dicatat");
  return rows;
}

export function buildInterfaceReport(data = {}) {
  const routes = buildInterfaceRoutes(data);
  const olts = new Map((data.olts || []).map((o) => [Number(o.id), o]));
  const items = sortInterfaces(data.ports || []).map((port) => {
    const olt = olts.get(Number(port.olt_id));
    const enriched = { ...port, ...interfaceDetails(port, { ...olt, ...port }) };
    return { key: `port-${port.id}`, port: enriched, olt, groups: [], rows: [], issues: [], unmapped: false,
      odcIds: new Set(), odpIds: new Set(), status: PORT_STATUS[port.status]?.label || "Belum dicatat" };
  });
  const byPort = new Map(items.map((item) => [Number(item.port.id), item]));
  for (const group of routes.groups) {
    const known = group.port ? byPort.get(Number(group.port.id)) : null;
    const rows = routeRows(group);
    if (known) {
      known.groups.push(group); known.rows.push(...rows);
      group.odcIds.forEach((id) => known.odcIds.add(id));
      group.odpIds.forEach((id) => known.odpIds.add(id));
    } else {
      const item = { key: `unmapped-${group.id}`, port: null, olt: group.olt, groups: [group], rows, issues: [], unmapped: true,
        odcIds: new Set(group.odcIds), odpIds: new Set(group.odpIds), status: "Sumber belum dikonfirmasi", reason: sourceReason(group) };
      items.push(item);
      const recorded = group.mapping?.port_id ? byPort.get(Number(group.mapping.port_id)) : null;
      if (recorded) recorded.issues.push(`${group.odc.name} / ${coreText(group)}: ${sourceReason(group)}`);
    }
  }
  for (const item of items) {
    if (!item.rows.length) {
      item.rows.push({ key: `${item.key}/no-mapping`, odc: null, core: null, color: "", tube: null, path: `${item.olt?.name || item.port.olt_name || "OLT"} → ${interfaceLabel(item.port)}`,
        target: "Belum ada tujuan", location: "", condition: item.issues.length ? "Mapping tercatat tetapi sumber belum dapat dikonfirmasi" : "Belum ada mapping interface ke core feeder", notes: "", sourceReason: "" });
    }
    item.rows.sort((a, b) => natural(a.odc?.name, b.odc?.name) || (a.core ?? 999) - (b.core ?? 999));
    item.searchText = [item.olt?.name, item.olt?.olt_type, interfaceLabel(item.port), item.port?.interface_cli, item.status, item.reason, ...item.issues,
      ...item.rows.flatMap((r) => [r.path, r.target, r.location, r.condition, r.sourceReason, r.notes, r.color, r.core == null ? "" : `core ${r.core}`])].filter(Boolean).join(" ").toLowerCase();
  }
  return { items, routes };
}

export function filterInterfaceReport(items, { oltId = "all", portId = "all", query = "" } = {}) {
  const q = query.trim().toLowerCase();
  return items.filter((item) => (oltId === "all" || String(item.olt?.id ?? item.port?.olt_id) === String(oltId))
    && (portId === "all" || (portId === "unmapped" ? item.unmapped : String(item.port?.id) === String(portId)))
    && (!q || item.searchText.includes(q)));
}

export function summarizeInterfaceReport(items) {
  const odcs = new Set(), odps = new Set();
  for (const item of items) { item.odcIds.forEach((id) => odcs.add(id)); item.odpIds.forEach((id) => odps.add(id)); }
  return { interfaces: items.filter((i) => !i.unmapped).length, unmapped: items.filter((i) => i.unmapped).length,
    odcs: odcs.size, odps: odps.size, rows: items.reduce((sum, i) => sum + i.rows.length, 0) };
}

export function interfaceReportExport(items) {
  const only = items.length === 1 && items[0].port ? items[0] : null;
  const safeSlug = (s) => String(s || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80);
  return {
    judul: "Laporan Per Interface OLT", slug: only ? `laporan-interface-${safeSlug(only.olt?.name || only.port.olt_name)}-${safeSlug(interfaceLabel(only.port))}` : "laporan-per-interface",
    head: INTERFACE_REPORT_COLUMNS,
    rows: items.flatMap((item) => item.rows.map((row) => [item.olt?.name || item.port?.olt_name || "OLT belum diketahui", interfaceLabel(item.port), item.port?.interface_cli || "", item.status,
      row.odc?.name || "", row.core ?? "", row.color, row.tube == null ? "" : `Tube ${row.tube}`, row.path, row.target, row.location,
      [row.sourceReason, row.condition].filter(Boolean).join(" / "), [row.notes, ...item.issues].filter(Boolean).join(" / ")])),
  };
}
