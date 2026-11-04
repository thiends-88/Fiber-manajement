// Hanya di-load oleh worker impor / pengujian, bukan bundle awal atau API server.
import { SaxesParser } from "saxes";
import { unzipSync } from "fflate";
import {
  ROUTE_LIMITS,
  routeColor,
  validateRouteImport,
} from "./cable-routes.js";
const fail = (message) => {
  throw new Error(message);
};
const namespaces = new Set([
  "",
  "http://www.opengis.net/kml/2.2",
  "http://earth.google.com/kml/2.1",
  "http://earth.google.com/kml/2.0",
]);
function decode(bytes) {
  let encoding = "utf-8";
  if (bytes[0] === 255 && bytes[1] === 254) encoding = "utf-16le";
  else if (bytes[0] === 254 && bytes[1] === 255) encoding = "utf-16be";
  else {
    const declaration = new TextDecoder()
      .decode(bytes.subarray(0, 180))
      .match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i);
    if (declaration) encoding = declaration[1];
  }
  try {
    return new TextDecoder(encoding, { fatal: true })
      .decode(bytes)
      .replace(/^\ufeff/, "");
  } catch {
    fail("Encoding berkas tidak dapat dibaca. Simpan kembali sebagai UTF-8.");
  }
}
function coordinates(raw, separator = /\s+/) {
  if (!raw.trim()) fail("Ada garis tanpa koordinat.");
  const tuples = raw.trim().split(separator);
  if (tuples.length > ROUTE_LIMITS.verticesPerImport)
    fail("Terlalu banyak titik pembentuk garis dalam satu segmen.");
  return tuples.map((tuple) => {
    const parts = tuple.trim().split(",");
    if (
      ![2, 3].includes(parts.length) ||
      parts.some(
        (p) =>
          !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(p.trim()),
      )
    )
      fail(
        "Koordinat tidak valid; gunakan longitude,latitude[,altitude], dipisahkan spasi (KML) atau titik koma (CSV).",
      );
    return parts.map(Number);
  });
}
// RFC4180: kutip ganda, koma/newline dalam field, CRLF dan BOM. Tidak mengeksekusi formula.
function csvRows(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    endedQuote = false;
  const addField = () => {
    row.push(field);
    field = "";
    endedQuote = false;
    if (row.length > 32) fail("CSV memiliki terlalu banyak kolom.");
  };
  const addRow = () => {
    addField();
    if (row.some((v) => v.trim())) rows.push(row);
    row = [];
    if (rows.length > 10000) fail("CSV memiliki terlalu banyak baris.");
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          endedQuote = true;
        }
      } else field += char;
    } else if (char === '"') {
      if (field || endedQuote) fail("Kutip CSV tidak valid.");
      quoted = true;
    } else if (char === ",") addField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      addRow();
    } else {
      if (endedQuote) fail("Ada karakter sesudah penutup kutip CSV.");
      field += char;
    }
  }
  if (quoted) fail("Kutip CSV belum ditutup.");
  if (field || row.length || endedQuote) addRow();
  return rows;
}
function parseCsv(text) {
  const rows = csvRows(text);
  const headers = rows.shift()?.map((v) => v.trim().toLowerCase());
  if (
    !headers ||
    new Set(headers).size !== headers.length ||
    !["name", "type", "coordinates"].every((key) => headers.includes(key))
  )
    fail(
      "CSV harus memiliki kolom Name, Type, Coordinates; Description opsional.",
    );
  const routes = [];
  let ignored = 0,
    totalVertices = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length !== headers.length)
      fail(`Jumlah kolom CSV baris ${i + 2} tidak sesuai header.`);
    const row = Object.fromEntries(
      headers.map((key, col) => [key, rows[i][col]]),
    );
    if (!["line", "linestring"].includes(row.type.trim().toLowerCase())) {
      ignored++;
      continue;
    }
    if (routes.length >= ROUTE_LIMITS.routesPerImport)
      fail("Terlalu banyak segmen jalur dalam CSV.");
    try {
      const points = coordinates(row.coordinates, /;/);
      totalVertices += points.length;
      if (totalVertices > ROUTE_LIMITS.verticesPerImport)
        fail(
          "Terlalu banyak titik pembentuk garis. Bagi berkas menjadi beberapa bagian.",
        );
      routes.push({
        name: row.name.trim() || `Segmen ${i + 2}`,
        description: row.description || "",
        folder: "",
        color: routeColor(row.name),
        coordinates: points,
      });
    } catch (e) {
      fail(`CSV baris ${i + 2}: ${e.message}`);
    }
  }
  return {
    routes,
    warnings: ignored
      ? [
          `${ignored} record bukan garis diabaikan. Titik perangkat tetap berasal dari inventaris aplikasi.`,
        ]
      : [],
  };
}
function parseKml(text) {
  const stack = [],
    folders = [],
    routes = [],
    styles = new Map(),
    styleMaps = new Map();
  let placemark = null,
    line = null,
    style = null,
    styleMap = null,
    pair = null,
    rootSeen = false,
    nodes = 0,
    vertices = 0;
  const ignored = {
    Point: 0,
    Polygon: 0,
    Track: 0,
    NetworkLink: 0,
    Schematic: 0,
  };
  let dataKey = null;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () =>
    fail(
      "DOCTYPE/entity tidak diizinkan. Tidak ada sumber eksternal yang diakses.",
    ),
  );
  parser.on("error", () =>
    fail("XML/KML rusak atau tidak lengkap. Simpan ulang KML lalu coba lagi."),
  );
  parser.on("opentag", (tag) => {
    if (++nodes > 100000 || stack.length >= 64)
      fail("Struktur XML terlalu besar/dalam.");
    if (!rootSeen) {
      rootSeen = true;
      if (tag.local !== "kml" || !namespaces.has(tag.uri))
        fail("XML ini bukan dokumen KML yang didukung.");
    }
    const kml = namespaces.has(tag.uri),
      parent = stack.at(-1)?.local;
    const frame = {
      local: tag.local,
      kml,
      text: "",
      capture:
        kml &&
        [
          "name",
          "description",
          "coordinates",
          "styleUrl",
          "color",
          "key",
          "value",
        ].includes(tag.local),
    };
    stack.push(frame);
    if (!kml) {
      if (tag.local === "Track") ignored.Track++;
      return;
    }
    const id = tag.attributes.id?.value;
    if (tag.local === "Data" && parent === "ExtendedData" && placemark)
      dataKey = tag.attributes.name?.value;
    if (tag.local === "Folder") folders.push({ name: "", depth: stack.length });
    if (Object.hasOwn(ignored, tag.local)) ignored[tag.local]++;
    if (tag.local === "Placemark") {
      if (placemark) fail("Placemark bertumpuk tidak didukung.");
      placemark = {
        name: "",
        description: "",
        styleUrl: "",
        folder: folders
          .map((f) => f.name)
          .filter(Boolean)
          .join(" / "),
        lines: [],
        inlineColor: null,
      };
    }
    if (tag.local === "LineString") {
      if (line) fail("LineString bertumpuk tidak valid.");
      line = { coordinates: null };
    }
    if (tag.local === "Style")
      style = { id, color: null, inline: Boolean(placemark) };
    if (tag.local === "StyleMap") styleMap = { id, normal: null };
    if (tag.local === "Pair" && parent === "StyleMap") pair = {};
  });
  const append = (value) => {
    const frame = stack.at(-1);
    if (frame?.capture) {
      frame.text += value;
      if (
        frame.text.length >
        (frame.local === "coordinates" ? 2 * 1024 * 1024 : 16000)
      )
        fail("Field KML terlalu panjang.");
    }
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    const frame = stack.pop();
    if (!frame.kml) return;
    const parent = stack.at(-1)?.local,
      value = frame.text.trim();
    if (frame.local === "value" && parent === "Data" && placemark) {
      if (dataKey === "fiber_route_note") placemark.routeNote = value;
      if (dataKey === "fiber_route_folder") placemark.routeFolder = value;
      if (dataKey === "fiber_geometry_kind") placemark.geometryKind = value;
    }
    if (frame.local === "Data") dataKey = null;
    if (frame.local === "name") {
      if (parent === "Placemark" && placemark) placemark.name = value;
      else if (parent === "Folder" && folders.length)
        folders.at(-1).name = value;
    }
    if (frame.local === "description" && parent === "Placemark" && placemark)
      placemark.description = value;
    if (frame.local === "styleUrl") {
      if (parent === "Placemark" && placemark) placemark.styleUrl = value;
      else if (pair) pair.url = value;
    }
    if (frame.local === "key" && pair) pair.key = value;
    if (
      frame.local === "color" &&
      parent === "LineStyle" &&
      style &&
      /^[\da-f]{8}$/i.test(value)
    )
      style.color =
        `#${value.slice(6, 8)}${value.slice(4, 6)}${value.slice(2, 4)}`.toLowerCase();
    if (frame.local === "coordinates" && parent === "LineString" && line) {
      if (line.coordinates)
        fail("Satu LineString memiliki lebih dari satu koordinat.");
      line.coordinates = coordinates(value);
      vertices += line.coordinates.length;
      if (vertices > ROUTE_LIMITS.verticesPerImport)
        fail(
          "Terlalu banyak titik pembentuk garis. Bagi berkas menjadi beberapa bagian.",
        );
    }
    if (frame.local === "LineString") {
      if (!placemark || !line?.coordinates)
        fail("LineString harus berada dalam Placemark dan memiliki koordinat.");
      placemark.lines.push(line.coordinates);
      line = null;
    }
    if (frame.local === "Style") {
      if (style?.inline && placemark) placemark.inlineColor = style.color;
      else if (style?.id) {
        if (styles.has(style.id))
          fail("ID Style KML ganda; sumber warna ambigu.");
        styles.set(style.id, style.color);
      }
      style = null;
    }
    if (frame.local === "Pair" && styleMap && pair) {
      if (pair.key === "normal") styleMap.normal = pair.url;
      pair = null;
    }
    if (frame.local === "StyleMap") {
      if (styleMap?.id) {
        if (styleMaps.has(styleMap.id)) fail("ID StyleMap ganda.");
        styleMaps.set(styleMap.id, styleMap.normal);
      }
      styleMap = null;
    }
    if (frame.local === "Placemark") {
      if (placemark.geometryKind === "schematic")
        ignored.Schematic += placemark.lines.length;
      else
        placemark.lines.forEach((points, index) => {
          if (routes.length >= ROUTE_LIMITS.routesPerImport)
            fail("Terlalu banyak segmen jalur.");
          routes.push({
            name: placemark.name || `Segmen ${routes.length + 1}`,
            description: placemark.routeNote ?? placemark.description,
            folder: placemark.routeFolder ?? placemark.folder,
            coordinates: points,
            color: placemark.inlineColor,
            styleUrl: placemark.styleUrl,
          });
        });
      placemark = null;
    }
    if (frame.local === "Folder") folders.pop();
  });
  try {
    parser.write(text).close();
  } catch (error) {
    throw new Error(error.message || "KML tidak valid.");
  }
  const warnings = [];
  let remoteStyle = 0;
  for (const route of routes) {
    let ref = route.styleUrl;
    if (ref?.startsWith("#") && styleMaps.has(ref.slice(1)))
      ref = styleMaps.get(ref.slice(1));
    if (ref && !ref.startsWith("#")) remoteStyle++;
    route.color ||=
      (ref?.startsWith("#") ? styles.get(ref.slice(1)) : null) ||
      routeColor(route.name);
    delete route.styleUrl;
  }
  if (ignored.Point || ignored.Polygon || ignored.Track)
    warnings.push(
      `${ignored.Point} Point, ${ignored.Polygon} Polygon, ${ignored.Track} Track diabaikan; hanya LineString diimpor. Titik inventaris tidak ditimpa.`,
    );
  if (ignored.NetworkLink)
    warnings.push(
      `${ignored.NetworkLink} NetworkLink diabaikan; berkas/tautan lain tidak diambil otomatis. Hanya garis yang berhasil dibaca pada ringkasan impor disimpan.`,
    );
  if (ignored.Schematic)
    warnings.push(
      `${ignored.Schematic} garis skematis aplikasi diabaikan; bukan diimpor sebagai jalur kabel.`,
    );
  if (remoteStyle)
    warnings.push(
      "Style eksternal tidak diunduh; warna pengganti lokal digunakan.",
    );
  return { routes, warnings };
}
export function parseRouteFile(input, filename = "jalur.kml") {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length || bytes.byteLength > ROUTE_LIMITS.fileBytes)
    fail("Berkas kosong atau melebihi batas 3 MB.");
  let source_format, result, text;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    source_format = "KMZ";
    const entries = [];
    let count = 0,
      total = 0;
    try {
      unzipSync(bytes, {
        filter: (entry) => {
          if (++count > 1000) fail("KMZ memiliki terlalu banyak entri.");
          if (/\.kml$/i.test(entry.name)) {
            total += entry.originalSize;
            if (!Number.isFinite(total) || total > ROUTE_LIMITS.xmlBytes)
              fail("Isi KML KMZ melebihi batas 8 MB.");
            entries.push(entry.name);
          }
          return false;
        },
      });
      if (
        new Set(entries.map((name) => name.toLowerCase())).size !==
        entries.length
      )
        fail("Nama KML ganda/ambigu dalam KMZ.");
      const doc =
        entries.find((name) => name.toLowerCase() === "doc.kml") ||
        (entries.length === 1 ? entries[0] : null);
      if (!doc)
        fail(
          "KMZ harus memiliki doc.kml atau tepat satu berkas KML. Simpan ulang jalur sebagai satu KML mandiri.",
        );
      const files = unzipSync(bytes, { filter: (entry) => entry.name === doc });
      if (!files[doc] || files[doc].length > ROUTE_LIMITS.xmlBytes)
        fail("KML dalam KMZ terlalu besar/tidak terbaca.");
      text = decode(files[doc]);
      result = parseKml(text);
      if (entries.length > 1)
        result.warnings.push(
          `${entries.length - 1} KML selain ${doc} tidak diimpor. Gabungkan jalur ke satu dokumen bila diperlukan.`,
        );
    } catch (e) {
      fail(`KMZ tidak dapat dibaca: ${e.message}`);
    }
  } else {
    text = decode(bytes);
    if (text.trimStart().startsWith("<")) {
      source_format = "KML";
      result = parseKml(text);
    } else {
      source_format = "CSV";
      result = parseCsv(text);
    }
  }
  if (!result.routes.length)
    fail(
      "Tidak ada garis LineString/line yang dapat diimpor. Berkas titik, Polygon, Track atau NetworkLink saja bukan jalur mandiri.",
    );
  const name =
    filename
      .replace(/^.*[\\/]/, "")
      .replace(/(?:\.(?:kmz|kml|xml|csv))+$/i, "")
      .slice(0, 160) || "Jalur kabel";
  const validated = validateRouteImport({
    name,
    source_name: filename,
    source_format,
    routes: result.routes,
  });
  return { ...validated, warnings: result.warnings };
}
