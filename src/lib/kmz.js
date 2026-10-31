import { zipSync, strToU8 } from "fflate";
import { MAP_TYPES, SCHEMATIC_NOTICE } from "./network-map.js";
import { coordinateText } from "./coordinates.js";

// XML 1.0 tidak menerima control characters/lone surrogates dari catatan bebas.
export function xmlEscape(value) {
  const text = Array.from(String(value ?? ""), (char) => {
    const cp = char.codePointAt(0);
    return cp >= 0xd800 && cp <= 0xdfff ? "�" : char;
  })
    .join("")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
const data = (name, value) =>
  `<Data name="${xmlEscape(name)}"><value>${xmlEscape(value)}</value></Data>`;
// Description adalah HTML dalam teks XML, jadi data pengguna harus di-escape dua lapis.
const description = (rows) =>
  xmlEscape(
    `<table>${rows.map(([label, value]) => `<tr><th>${xmlEscape(label)}</th><td>${xmlEscape(value)}</td></tr>`).join("")}</table>`,
  );
const coords = (point) => `${point.longitude},${point.latitude},0`;
const lineStyle = (id, color) =>
  `<Style id="${id}"><LineStyle><color>${color}</color><width>2.5</width></LineStyle><BalloonStyle><text>$[description]</text></BalloonStyle></Style>`;

export function buildKml(
  view,
  {
    scope = "lengkap",
    includeConnections = true,
    exportedAt = new Date(),
  } = {},
) {
  const date = new Date(exportedAt).toISOString();
  const points = view.points.filter(
    (node) =>
      node.coordinates.status === "valid" &&
      Number.isFinite(node.coordinates.latitude) &&
      Number.isFinite(node.coordinates.longitude) &&
      Math.abs(node.coordinates.latitude) <= 90 &&
      Math.abs(node.coordinates.longitude) <= 180,
  );
  const keys = new Set(points.map((n) => n.key));
  const lines = includeConnections
    ? view.lines.filter(
        (edge) => keys.has(edge.from.key) && keys.has(edge.to.key),
      )
    : [];
  const styles = Object.keys(MAP_TYPES)
    .map(
      (kind) =>
        `<Style id="${kind}"><IconStyle><scale>0.85</scale><Icon><href>icons/${kind}.png</href></Icon><hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle><BalloonStyle><text>$[description]</text></BalloonStyle></Style>`,
    )
    .join("");
  const folders = Object.entries(MAP_TYPES)
    .map(
      ([kind, type]) =>
        `<Folder><name>${type.label}</name>${points
          .filter((n) => n.kind === kind)
          .map((node) => {
            const rows = [
              ["Perangkat", `${type.label} #${node.id} · ${node.name}`],
              ["Lokasi", node.location || "—"],
              ["Koordinat WGS84 (lat, lon)", coordinateText(node.coordinates)],
              [
                "Sumber koordinat",
                node.coordinates.source === "manual"
                  ? "GPS terpisah"
                  : "Lokasi lama",
              ],
              ["OLT induk inventaris", node.oltName],
              ["ODC induk inventaris", node.odcName || "—"],
              ["Catatan", node.notes || "—"],
              ["Batas interpretasi", SCHEMATIC_NOTICE],
            ];
            return `<Placemark id="point-${xmlEscape(node.key)}"><name>${xmlEscape(node.name)}</name><description>${description(rows)}</description><styleUrl>#${kind}</styleUrl><ExtendedData>${data("device_type", type.label)}${data("device_id", node.id)}${data("coordinate_source", node.coordinates.source)}${data("olt_inventory_id", node.oltId ?? "")}${data("odc_inventory_id", node.odcId ?? "")}</ExtendedData><Point><altitudeMode>clampToGround</altitudeMode><coordinates>${coords(node.coordinates)}</coordinates></Point></Placemark>`;
          })
          .join("")}</Folder>`,
    )
    .join("");
  const lineFolder = `<Folder><name>Koneksi skematis (${lines.length}) — bukan rute kabel</name><description>${xmlEscape(SCHEMATIC_NOTICE)}</description>${lines
    .map(
      (edge) =>
        `<Placemark id="connection-${xmlEscape(edge.key)}"><name>${xmlEscape(`${edge.from.name} → ${edge.to.name}`)}</name><description>${description(
          [
            ["Peringatan", SCHEMATIC_NOTICE],
            ["Bukti tercatat", edge.evidence.join("\n")],
            [
              "Pemeriksaan receiver",
              edge.review
                ? edge.reviewReasons?.join("; ") ||
                  "Belum dipilih/valid; verifikasi di Mapping Core"
                : "Lihat bukti sambungan tercatat",
            ],
          ],
        )}</description><styleUrl>#${edge.review ? "review" : "connection"}</styleUrl><LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>${coords(edge.from.coordinates)} ${coords(edge.to.coordinates)}</coordinates></LineString></Placemark>`,
    )
    .join("")}</Folder>`;
  const missing = view.missing || [];
  const missingFolder = `<Folder><name>Belum ada koordinat (${missing.length})</name><description>${description(missing.map((n) => [`${MAP_TYPES[n.kind].label} #${n.id} · ${n.name}`, n.coordinates.reason]))}</description></Folder>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Peta Jaringan — ${xmlEscape(scope)}</name><description>${description(
    [
      ["Cakupan", scope],
      ["Waktu data dibaca (UTC)", date],
      ["Titik valid", points.length],
      ["Tanpa koordinat (tidak diberi geometri)", missing.length],
      ["Koneksi tanpa kedua koordinat", view.unpositionedConnections || 0],
      ["Koneksi di luar filter", view.hiddenConnections || 0],
      ["Peringatan", SCHEMATIC_NOTICE],
    ],
  )}</description>${styles}${lineStyle("connection", "ffeb9938")}${lineStyle("review", "ff0b9ef5")}${folders}${lineFolder}${missingFolder}</Document></kml>`;
}

export function createKmz(view, options, icons) {
  const files = { "doc.kml": strToU8(buildKml(view, options)) };
  for (const kind of Object.keys(MAP_TYPES)) {
    if (
      !(icons?.[kind] instanceof Uint8Array) ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every(
        (byte, index) => icons[kind][index] === byte,
      )
    )
      throw new Error(
        `Ikon ${kind.toUpperCase()} belum tersedia; KMZ tidak dibuat setengah lengkap.`,
      );
    files[`icons/${kind}.png`] = icons[kind];
  }
  return zipSync(files, { level: 6 });
}
