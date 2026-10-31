import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getSessionVersion } from "./api.js";
import {
  combinedRouteBounds,
  routeBounds,
  validateRouteImport,
} from "./cable-routes.js";
const aborted = () => new DOMException("Sesi/tampilan berubah", "AbortError");
export function useCableRoutes() {
  const [imports, setImports] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [loadedAt, setLoadedAt] = useState(null);
  const [hidden, setHidden] = useState(new Set()),
    [revision, setRevision] = useState(0),
    [geometryErrors, setGeometryErrors] = useState({}),
    [mutating, setMutating] = useState(false);
  const mounted = useRef(false),
    generation = useRef(0),
    cache = useRef(new Map()),
    pending = useRef(new Map()),
    attempted = useRef(new Set()),
    mutationBusy = useRef(false);
  const reload = useCallback(async () => {
    const gen = ++generation.current,
      session = getSessionVersion();
    setLoading(true);
    setError("");
    setLoadedAt(null);
    setImports(null);
    setGeometryErrors({});
    attempted.current.clear();
    try {
      const data = await api("/api/route-imports");
      if (
        data?.version !== 1 ||
        !Array.isArray(data.imports) ||
        data.imports.some(
          (row) =>
            !Number.isSafeInteger(row.id) ||
            row.id < 1 ||
            typeof row.name !== "string" ||
            !Number.isInteger(row.route_count) ||
            row.route_count < 1 ||
            !Number.isInteger(row.vertex_count) ||
            row.vertex_count < 2 ||
            !Array.isArray(row.bounds) ||
            row.bounds.length !== 4 ||
            !row.bounds.every(Number.isFinite),
        )
      )
        throw Error(
          "Daftar jalur belum lengkap/valid. Muat ulang sebelum mengekspor KMZ lengkap.",
        );
      if (
        !mounted.current ||
        gen !== generation.current ||
        session !== getSessionVersion()
      )
        return;
      const ids = new Set(data.imports.map((row) => row.id));
      for (const id of cache.current.keys())
        if (!ids.has(id)) cache.current.delete(id);
      setImports(data.imports);
      setLoadedAt(new Date().toISOString());
      setHidden((old) => new Set([...old].filter((id) => ids.has(id))));
    } catch (e) {
      if (
        mounted.current &&
        gen === generation.current &&
        session === getSessionVersion()
      ) {
        setError(e.message);
        setImports(null);
      }
    } finally {
      if (mounted.current && gen === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    reload();
    return () => {
      mounted.current = false;
      generation.current++;
      cache.current.clear();
      pending.current.clear();
    };
  }, [reload]);
  const ensureGeometry = useCallback(async (batch) => {
    if (cache.current.has(batch.id)) return cache.current.get(batch.id);
    const gen = generation.current,
      session = getSessionVersion(),
      key = `${gen}:${batch.id}`;
    if (pending.current.has(key)) return pending.current.get(key);
    if (pending.current.size >= 3) {
      await Promise.race(
        [...pending.current.values()].map((task) => task.catch(() => {})),
      );
      if (
        !mounted.current ||
        gen !== generation.current ||
        session !== getSessionVersion()
      )
        throw aborted();
      return ensureGeometry(batch);
    }
    attempted.current.add(batch.id);
    const task = (async () => {
      try {
        const data = await api(`/api/route-imports/${batch.id}`);
        if (
          data?.version !== 1 ||
          data.import?.id !== batch.id ||
          !Array.isArray(data.routes) ||
          new Set(data.routes.map((r) => r.id)).size !== data.routes.length ||
          data.routes.some(
            (r) =>
              !Number.isSafeInteger(r.id) ||
              r.id < 1 ||
              r.import_id !== batch.id,
          )
        )
          throw Error("Geometri jalur tidak lengkap/valid.");
        const checked = validateRouteImport({
          ...data.import,
          routes: data.routes,
        });
        if (
          checked.route_count !== batch.route_count ||
          checked.vertex_count !== batch.vertex_count
        )
          throw Error(
            "Jumlah geometri jalur berbeda dari daftar. Muat ulang jalur.",
          );
        const routes = checked.routes.map((route, i) => ({
          ...route,
          id: data.routes[i].id,
          import_id: batch.id,
          ordinal: i + 1,
          batch_name: batch.name,
          source_name: batch.source_name,
          source_format: batch.source_format,
          imported_at: batch.created_at,
          import_warnings: batch.warnings || [],
          bounds: routeBounds(route.coordinates),
        }));
        if (
          !mounted.current ||
          gen !== generation.current ||
          session !== getSessionVersion()
        )
          throw aborted();
        cache.current.set(batch.id, routes);
        setGeometryErrors((old) => {
          const next = { ...old };
          delete next[batch.id];
          return next;
        });
        return routes;
      } catch (e) {
        if (
          mounted.current &&
          gen === generation.current &&
          session === getSessionVersion() &&
          e.name !== "AbortError"
        )
          setGeometryErrors((old) => ({ ...old, [batch.id]: e.message }));
        throw e;
      } finally {
        pending.current.delete(key);
        if (mounted.current) setRevision((v) => v + 1);
      }
    })();
    pending.current.set(key, task);
    return task;
  }, []);
  useEffect(() => {
    if (!imports) return;
    let active = true,
      cursor = 0;
    const todo = imports.filter(
      (batch) =>
        !hidden.has(batch.id) &&
        !cache.current.has(batch.id) &&
        !attempted.current.has(batch.id),
    );
    async function run() {
      while (active && cursor < todo.length) {
        const batch = todo[cursor++];
        try {
          await ensureGeometry(batch);
        } catch {
          /* error ditampilkan per kumpulan; tidak mengulang otomatis */
        }
      }
    }
    const slots = Math.min(Math.max(0, 3 - pending.current.size), todo.length);
    for (let i = 0; i < slots; i++) run();
    return () => {
      active = false;
    };
  }, [imports, hidden, ensureGeometry, revision]);
  const visibleImports = useMemo(
    () => (imports || []).filter((batch) => !hidden.has(batch.id)),
    [imports, hidden],
  );
  const visibleRoutes = useMemo(
    () => visibleImports.flatMap((batch) => cache.current.get(batch.id) || []),
    [visibleImports, revision],
  );
  const ensureExport = async (filtered) => {
    if (loading || error || !imports)
      throw Error(
        "Daftar jalur belum siap. Muat ulang daftar jalur sebelum mengekspor.",
      );
    const batches = filtered ? visibleImports : imports;
    const result = [];
    // Maksimal satu geometri aktif saat ekspor: peak memory dan permintaan dibatasi.
    for (const batch of batches) result.push(...(await ensureGeometry(batch)));
    return result;
  };
  const mutate = async (method, path, body) => {
    if (mutationBusy.current)
      throw Error("Penyimpanan jalur masih berlangsung.");
    mutationBusy.current = true;
    setMutating(true);
    const session = getSessionVersion();
    try {
      const result = await api(path, { method, body });
      if (!mounted.current || session !== getSessionVersion()) throw aborted();
      await reload();
      return result;
    } finally {
      mutationBusy.current = false;
      if (mounted.current) setMutating(false);
    }
  };
  return {
    imports,
    loading,
    error,
    loadedAt,
    hidden,
    geometryErrors,
    mutating,
    visibleImports,
    visibleRoutes,
    ensureExport,
    reload,
    toggle: (id) =>
      setHidden((old) => {
        const next = new Set(old);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      }),
    create: (body) => mutate("POST", "/api/route-imports", body),
    remove: (id) => mutate("DELETE", `/api/route-imports/${id}`),
    bounds: combinedRouteBounds(visibleImports),
    totalRoutes: (imports || []).reduce(
      (sum, batch) => sum + batch.route_count,
      0,
    ),
    totalVertices: (imports || []).reduce(
      (sum, batch) => sum + batch.vertex_count,
      0,
    ),
  };
}
