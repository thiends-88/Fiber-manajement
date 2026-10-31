// Kontrak ringan bersama browser/server. Tidak memuat parser ZIP/XML di runtime API.
export const ROUTE_LIMITS = Object.freeze({
  fileBytes: 3 * 1024 * 1024,
  xmlBytes: 8 * 1024 * 1024,
  payloadBytes: 900 * 1024,
  routesPerImport: 500,
  verticesPerImport: 20000,
  imports: 20,
  totalRoutes: 2000,
  totalVertices: 100000,
});
export const ROUTE_NOTICE =
  "Jalur mengikuti berkas impor, bukan bukti sambungan port/core. Ketepatan lapangan mengikuti sumber berkas.";
export const ROUTE_COLORS = [
  "#22d3ee",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#fb7185",
  "#60a5fa",
];
export function routeError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
export function routeColor(name = "") {
  let hash = 0;
  for (const char of String(name).toLowerCase())
    hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return ROUTE_COLORS[hash % ROUTE_COLORS.length];
}
function text(value, name, max, required = false) {
  if (value == null && !required) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value) ||
    (required && !value.trim())
  ) {
    throw routeError(
      `${name} wajib berupa teks${required ? " tidak kosong" : ""}, maksimal ${max} karakter tanpa karakter kontrol.`,
    );
  }
  return value.trim();
}
export function routeBounds(coordinates) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of coordinates) {
    bounds[0] = Math.min(bounds[0], lon);
    bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lon);
    bounds[3] = Math.max(bounds[3], lat);
  }
  return bounds;
}
export function combinedRouteBounds(routes) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const route of routes) {
    const b = route.bounds || routeBounds(route.coordinates);
    bounds[0] = Math.min(bounds[0], b[0]);
    bounds[1] = Math.min(bounds[1], b[1]);
    bounds[2] = Math.max(bounds[2], b[2]);
    bounds[3] = Math.max(bounds[3], b[3]);
  }
  return routes.length ? bounds : null;
}
export function validateRouteImport(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw routeError("Data impor jalur tidak valid.");
  const name = text(input.name, "Nama kumpulan", 160, true);
  const source_name = text(input.source_name, "Nama berkas", 240, true)
    .split(/[\\/]/)
    .pop();
  if (!source_name) throw routeError("Nama berkas tidak valid.");
  if (!["KMZ", "KML", "CSV"].includes(input.source_format))
    throw routeError("Format sumber harus KMZ, KML, atau CSV.");
  if (
    !Array.isArray(input.routes) ||
    !input.routes.length ||
    input.routes.length > ROUTE_LIMITS.routesPerImport
  )
    throw routeError(
      `Impor harus berisi 1–${ROUTE_LIMITS.routesPerImport} segmen jalur.`,
    );
  let vertex_count = 0;
  const routes = input.routes.map((item, i) => {
    const label = `Segmen ${i + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw routeError(`${label} tidak valid.`);
    const route = {
      name: text(item.name, `${label}: nama`, 160, true),
      description: text(item.description, `${label}: catatan`, 2000),
      folder: text(item.folder, `${label}: folder`, 300),
      color: item.color ?? routeColor(item.name),
    };
    if (typeof route.color !== "string" || !/^#[\da-f]{6}$/i.test(route.color))
      throw routeError(`${label}: warna harus #RRGGBB.`);
    route.color = route.color.toLowerCase();
    if (!Array.isArray(item.coordinates) || item.coordinates.length < 2)
      throw routeError(
        `${label} memerlukan minimal dua titik pembentuk garis.`,
      );
    vertex_count += item.coordinates.length;
    if (vertex_count > ROUTE_LIMITS.verticesPerImport)
      throw routeError(
        `Maksimal ${ROUTE_LIMITS.verticesPerImport.toLocaleString("id-ID")} titik pembentuk garis per impor. Bagi berkas menjadi beberapa bagian.`,
      );
    route.coordinates = item.coordinates.map((point) => {
      if (
        !Array.isArray(point) ||
        ![2, 3].includes(point.length) ||
        !point.every((v) => typeof v === "number" && Number.isFinite(v)) ||
        Math.abs(point[0]) > 180 ||
        Math.abs(point[1]) > 90 ||
        (point.length === 3 && Math.abs(point[2]) > 100000)
      )
        throw routeError(
          `${label}: koordinat harus longitude,latitude[,altitude] WGS84 yang valid; sumbu tidak ditukar otomatis.`,
        );
      return [...point];
    });
    const first = route.coordinates[0];
    if (!route.coordinates.some((p) => p[0] !== first[0] || p[1] !== first[1]))
      throw routeError(`${label}: semua posisi sama, bukan garis jalur.`);
    return route;
  });
  if (
    input.warnings != null &&
    (!Array.isArray(input.warnings) || input.warnings.length > 10)
  )
    throw routeError("Catatan impor tidak valid.");
  const warnings = (input.warnings || []).map((value) =>
    text(value, "Catatan impor", 2000, true),
  );
  const result = {
    name,
    source_name,
    source_format: input.source_format,
    warnings,
    routes,
  };
  if (
    new TextEncoder().encode(JSON.stringify(result)).byteLength >
    ROUTE_LIMITS.payloadBytes
  )
    throw routeError(
      "Data jalur terlalu besar untuk satu penyimpanan. Bagi menjadi berkas lebih kecil.",
      413,
    );
  return {
    ...result,
    route_count: routes.length,
    vertex_count,
    bounds: combinedRouteBounds(routes),
  };
}
