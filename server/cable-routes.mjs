import { createHash } from "node:crypto";
import {
  ROUTE_LIMITS,
  routeError,
  validateRouteImport,
  routeBounds,
} from "../src/lib/cable-routes.js";

// Tidak ada FK/mutasi ke inventaris/akun. Setiap impor immutable, hapus per kumpulan.
export function createCableRouteStore(db, atomicWrite) {
  atomicWrite(() =>
    db.exec(`
    CREATE TABLE IF NOT EXISTS map_route_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_format TEXT NOT NULL CHECK(source_format IN ('KMZ','KML','CSV')),
      content_hash TEXT NOT NULL UNIQUE,
      warnings TEXT NOT NULL DEFAULT '[]',
      route_count INTEGER NOT NULL,
      vertex_count INTEGER NOT NULL,
      bounds TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS map_route_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL REFERENCES map_route_imports(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      folder TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL,
      coordinates TEXT NOT NULL,
      vertex_count INTEGER NOT NULL,
      bounds TEXT NOT NULL,
      UNIQUE(import_id,ordinal)
    );
  `),
  );
  const columns =
    "id,name,source_name,source_format,warnings,route_count,vertex_count,bounds,created_at";
  const meta = (row) =>
    row && {
      ...row,
      warnings: JSON.parse(row.warnings),
      bounds: JSON.parse(row.bounds),
    };
  const byId = db.prepare(
    `SELECT ${columns} FROM map_route_imports WHERE id=?`,
  );
  const totals = db.prepare(
    "SELECT COUNT(*) AS imports, COALESCE(SUM(route_count),0) AS routes, COALESCE(SUM(vertex_count),0) AS vertices FROM map_route_imports",
  );
  return {
    index() {
      return {
        version: 1,
        imports: db
          .prepare(`SELECT ${columns} FROM map_route_imports ORDER BY id`)
          .all()
          .map(meta),
      };
    },
    geometry(id) {
      const batch = meta(byId.get(id));
      if (!batch)
        throw routeError(
          "Kumpulan jalur sudah tidak ada. Muat ulang daftar jalur.",
          404,
        );
      const routes = db
        .prepare(
          "SELECT id,import_id,ordinal,name,description,folder,color,coordinates,vertex_count,bounds FROM map_route_segments WHERE import_id=? ORDER BY ordinal",
        )
        .all(id)
        .map((row) => ({
          ...row,
          coordinates: JSON.parse(row.coordinates),
          bounds: JSON.parse(row.bounds),
        }));
      return { version: 1, import: batch, routes };
    },
    create(body) {
      const data = validateRouteImport(body);
      const hash = createHash("sha256")
        .update(
          JSON.stringify(
            data.routes.map((route) => ({
              ...route,
              coordinates: route.coordinates.map((p) => [
                p[0],
                p[1],
                p[2] ?? 0,
              ]),
            })),
          ),
        )
        .digest("hex");
      return atomicWrite(() => {
        const duplicate = db
          .prepare("SELECT name FROM map_route_imports WHERE content_hash=?")
          .get(hash);
        if (duplicate)
          throw routeError(
            `Jalur yang sama sudah tersimpan sebagai “${duplicate.name}”. Tidak ditambahkan dua kali.`,
            409,
          );
        const count = totals.get();
        if (
          count.imports >= ROUTE_LIMITS.imports ||
          count.routes + data.route_count > ROUTE_LIMITS.totalRoutes ||
          count.vertices + data.vertex_count > ROUTE_LIMITS.totalVertices
        )
          throw routeError(
            `Batas peta ringan tercapai: ${ROUTE_LIMITS.imports} kumpulan / ${ROUTE_LIMITS.totalRoutes} segmen / ${ROUTE_LIMITS.totalVertices.toLocaleString("id-ID")} titik pembentuk garis. Hapus kumpulan yang tidak dipakai sebelum mengimpor lagi.`,
            409,
          );
        const result = db
          .prepare(
            "INSERT INTO map_route_imports (name,source_name,source_format,content_hash,warnings,route_count,vertex_count,bounds,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
          )
          .run(
            data.name,
            data.source_name,
            data.source_format,
            hash,
            JSON.stringify(data.warnings),
            data.route_count,
            data.vertex_count,
            JSON.stringify(data.bounds),
            new Date().toISOString(),
          );
        const id = Number(result.lastInsertRowid);
        const insert = db.prepare(
          "INSERT INTO map_route_segments (import_id,ordinal,name,description,folder,color,coordinates,vertex_count,bounds) VALUES (?,?,?,?,?,?,?,?,?)",
        );
        data.routes.forEach((route, i) =>
          insert.run(
            id,
            i + 1,
            route.name,
            route.description,
            route.folder,
            route.color,
            JSON.stringify(route.coordinates),
            route.coordinates.length,
            JSON.stringify(routeBounds(route.coordinates)),
          ),
        );
        return meta(byId.get(id));
      });
    },
    remove(id) {
      return atomicWrite(() => {
        const result = db
          .prepare("DELETE FROM map_route_imports WHERE id=?")
          .run(id);
        if (!result.changes)
          throw routeError(
            "Kumpulan jalur sudah tidak ada. Muat ulang daftar jalur.",
            404,
          );
        return { ok: true };
      });
    },
  };
}
