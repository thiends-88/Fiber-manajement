import { colorForCoreInCable, coresPerTube } from "./fiber.js";
import { interfaceLabel } from "./interfaces.js";
import { EDGE_STYLE, layoutTopology } from "./topology.js";

// Satu ODC dapat muncul pada beberapa jalur. Jangan menggabungkan simpulnya:
// kalau digabung, port A tampak dapat mencapai ODP milik port B.
export function buildInterfaceTopology({ groups = [], unconnectedOdps = [], unconnectedOdcs = [], odcs = [], cores = [] } = {}) {
  const nodes = [];
  const edges = [];
  const ids = new Set();
  function add(id, kind, title, sub = "", extra = {}) {
    if (!ids.has(id)) {
      ids.add(id);
      nodes.push({ id, kind, fullTitle: title, title: title.length > 22 ? `${title.slice(0, 21)}…` : title,
        sub: sub.length > 28 ? `${sub.slice(0, 27)}…` : sub, searchText: `${title} ${sub} ${extra.sourceLabel || ""}`, ...extra });
    }
    return id;
  }
  function edge(from, to, kind, label, color) {
    edges.push({ id: `edge-${edges.length}`, from, to, kind, label, color: color || EDGE_STYLE[kind]?.color || "#94a3b8" });
  }
  const feedColor = (feed) => feed?.core == null ? undefined : colorForCoreInCable(feed.core, coresPerTube(feed.cableType)).hex;
  function append(node, parent, path, feed, group, kind = "feed", label = "") {
    const sourceLabel = `${group.olt?.name ?? ""} / ${interfaceLabel(group.port)}`;
    const id = `${path}/${node.kind}-${node.id ?? node.odcId ?? node.odpId ?? "stop"}`;
    if (node.kind === "terputus") {
      add(id, "warning", "Jalur perlu diperiksa", node.note, { sourceLabel });
      edge(parent, id, "core-empty", label || "terputus");
      return;
    }
    let sub = "";
    if (node.kind === "splitter") sub = `${node.ratio} · ${node.idlePorts} output kosong`;
    if (node.kind === "odc") sub = node.core == null ? "Core masuk belum diisi" : `Core ${node.core} · ${colorForCoreInCable(node.core, coresPerTube(node.cableType)).name}`;
    if (node.kind === "odp") sub = node.location || node.odcName || "Lokasi belum diisi";
    const extra = { sourceLabel, sourcePort: group.port };
    if (node.kind === "odp") {
      extra.coreIn = feed?.core == null ? [] : [{ core: feed.core, odcId: feed.odcId, odcName: feed.odcName, port: node.port ?? null,
        hex: feedColor(feed), colorName: colorForCoreInCable(feed.core, coresPerTube(feed.cableType)).name }];
      extra.powerCores = cores.filter((c) => c.source === "odc_to_odp" && Number(c.odp_id) === node.odpId).map((c) => {
        const color = colorForCoreInCable(c.core, coresPerTube(node.cableType));
        return { core: c.core, status: c.status, hex: color.hex, colorName: color.name };
      });
    }
    add(id, node.kind === "splitter" ? "spl" : node.kind, node.name, sub, extra);
    edge(parent, id, kind, label, feedColor(feed));
    const nextFeed = node.kind === "odc" && node.core != null ? { core: node.core, cableType: node.cableType, odcId: node.odcId, odcName: node.name } : feed;
    for (const [i, child] of (node.children || []).entries()) {
      const output = child.port ?? child.viaPort;
      const nextKind = child.kind === "odc" ? "splitter-odc" : child.kind === "odp" ? "out" : node.kind === "splitter" ? "cascade" : "feed";
      append(child, id, `${id}/${i}`, nextFeed, group, nextKind, output == null ? child.inputCore == null ? "input" : `core ${child.inputCore}` : `out ${output}`);
    }
    for (const [i, inside] of (node.insideTrees || []).entries()) append(inside, id, `${id}/inside-${i}`, nextFeed, group, "feed", "splitter di ODP");
  }

  for (const group of groups) {
    const sourceLabel = `${group.olt?.name ?? ""} / ${interfaceLabel(group.port)}`;
    const oltId = add(`olt-${group.olt?.id ?? group.odc.olt_id}`, "olt", group.olt?.name ?? "OLT ?", group.olt?.olt_type || "OLT");
    const portId = add(group.port ? `interface-${group.port.id}` : `unmapped-${group.id}`, "interface", group.port ? interfaceLabel(group.port) : "Interface belum dipetakan", group.port?.interface_cli || (group.port ? "Port fisik OLT" : "Bukan hasil perkiraan"), { sourceLabel, sourcePort: group.port });
    if (!edges.some((e) => e.from === oltId && e.to === portId)) edge(oltId, portId, group.port ? "feeder" : "core-empty", group.port ? "interface" : "perlu mapping");
    const feed = { core: group.core, cableType: group.odc.cable_type, odcId: group.odc.id, odcName: group.odc.name };
    const sub = group.core == null ? "Core masuk belum diisi" : `Core ${group.core} · ${colorForCoreInCable(group.core, coresPerTube(group.odc.cable_type)).name}`;
    const cabinet = add(`route-${group.id}/odc-${group.odc.id}`, "odc", group.odc.name, sub, { sourceLabel, sourcePort: group.port });
    edge(portId, cabinet, group.port ? "feeder" : "core-empty", group.core == null ? "core ?" : `core ${group.core}`, feedColor(feed));
    group.trees.forEach((tree, i) => append(tree.root, cabinet, `route-${group.id}/tree-${i}`, feed, group, "feed", group.core == null ? "core belum diisi" : `core ${group.core}`));
    group.directLinks.forEach((link, i) => append(link.node, cabinet, `route-${group.id}/direct-${i}`, feed, group, "core", `C${link.odcCore}→C${link.odpCore}`));
  }
  // Perangkat tanpa sambungan bukan anak dari sembarang interface.
  const disconnected = (odc) => add(`disconnected-odc-${odc.id}`, "odc", odc.name, "Belum ada jalur terpetakan");
  unconnectedOdcs.forEach(disconnected);
  for (const odp of unconnectedOdps) {
    const odc = odcs.find((d) => Number(d.id) === Number(odp.odc_id));
    const id = add(`disconnected-odp-${odp.id}`, "odp", odp.name, "Interface asal belum diketahui");
    if (odc) edge(disconnected(odc), id, "core-empty", "induk ODC · belum dipetakan");
  }
  return layoutTopology(nodes, edges, { olts: new Set(groups.map((g) => g.olt?.id)).size, odcs: odcs.length, odps: new Set(groups.flatMap((g) => [...g.odpIds])).size });
}
