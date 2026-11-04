import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { MAP_ICONS } from "../lib/map-icons.js";
import { MAP_TYPES } from "../lib/network-map.js";
import { coordinateText } from "../lib/coordinates.js";
import { ROUTE_NOTICE } from "../lib/cable-routes.js";
import MapViewport from "./MapViewport.jsx";
import {
  MAP_MAX_ZOOM,
  SATELLITE_NATIVE_ZOOM,
  SATELLITE_ERROR,
  SATELLITE_DETAIL_NOTICE,
  createSatelliteLayer,
} from "../lib/satellite-map.js";
const NO_ROUTES = [];

let enginePromise;
function loadEngine() {
  if (!enginePromise)
    enginePromise = (async () => {
      const { default: L } = await import("leaflet");
      window.L = L; // markercluster 1.x menggunakan instance Leaflet global yang sama.
      await import("leaflet.markercluster");
      if (!L.markerClusterGroup)
        throw new Error("Pengelompokan titik belum dapat dimuat.");
      return L;
    })().catch((error) => {
      enginePromise = null;
      throw error;
    });
  return enginePromise;
}
function textElement(tag, text, className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
function pointPopup(node, onSelect) {
  const content = textElement("div", "", "network-map-popup");
  content.append(
    textElement("strong", node.name),
    textElement(
      "p",
      `${MAP_TYPES[node.kind].label} · ${coordinateText(node.coordinates)}`,
    ),
    textElement("p", node.location || "Lokasi/alamat belum diisi."),
  );
  const button = textElement("button", "Lihat detail", "btn text-xs");
  button.type = "button";
  button.addEventListener("click", () => onSelect(node.key));
  content.append(button);
  return content;
}
function routePopup(route, onSelect) {
  const content = textElement("div", "", "network-map-popup");
  content.append(
    textElement("strong", route.name),
    textElement("p", `Jalur impor #${route.id} · ${route.batch_name}`),
    textElement("p", route.description || "Tidak ada catatan sumber."),
    textElement("p", ROUTE_NOTICE),
  );
  const button = textElement("button", "Detail jalur", "btn text-xs");
  button.type = "button";
  button.addEventListener("click", () => onSelect?.(route));
  content.append(button);
  return content;
}

export default function NetworkMapCanvas({
  points,
  routes = NO_ROUTES,
  routeFocus,
  selectedRouteId,
  onSelectRoute,
  focus,
  fitRevision,
  basemap,
  onSelect,
}) {
  const viewport = useRef(null),
    container = useRef(null),
    markers = useRef(new Map()),
    callback = useRef(onSelect),
    routeCallback = useRef(onSelectRoute),
    routeLayers = useRef(new Map());
  callback.current = onSelect;
  routeCallback.current = onSelectRoute;
  const [engine, setEngine] = useState(null),
    [error, setError] = useState(""),
    [tileError, setTileError] = useState(false),
    [lowerResolution, setLowerResolution] = useState(false),
    [mapZoom, setMapZoom] = useState(4),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      map,
      observer;
    setError("");
    loadEngine()
      .then((L) => {
        if (!active) return;
        try {
          map = L.map(container.current, {
            center: [0, 115],
            zoom: 4,
            minZoom: 2,
            maxZoom: MAP_MAX_ZOOM,
            attributionControl: false,
            zoomAnimation: false,
            markerZoomAnimation: false,
          });
          L.control.attribution({ prefix: false }).addTo(map);
          L.control.scale({ imperial: false }).addTo(map);
          const clusters = L.markerClusterGroup({
            animate: false,
            showCoverageOnHover: false,
            maxClusterRadius: 42,
            spiderfyOnMaxZoom: true,
            spiderfyDistanceMultiplier: 1.5,
            spiderLegPolylineOptions: {
              weight: 0,
              opacity: 0,
              interactive: false,
            },
            iconCreateFunction: (cluster) =>
              L.divIcon({
                html: `<span>${Number(cluster.getChildCount())}<span class="sr-only"> perangkat; klik untuk membuka grup</span></span>`,
                className: "network-map-cluster",
                iconSize: [38, 38],
              }),
          });
          clusters.addTo(map);
          map.createPane("cableRoutes");
          map.getPane("cableRoutes").style.zIndex = "390";
          const routeRenderer = L.canvas({
            pane: "cableRoutes",
            padding: 0.3,
            tolerance: 6,
          });
          const routeLayer = L.layerGroup().addTo(map);
          // Pan internal non-animasi mempertahankan pusat/zoom saat ukuran berubah.
          const resize = () => map.invalidateSize({ animate: false });
          if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(resize);
            observer.observe(container.current);
          }
          map._fiberResize = resize;
          window.addEventListener("resize", resize);
          setEngine({ L, map, clusters, routeRenderer, routeLayer });
        } catch (e) {
          if (active) setError(e.message);
          map?.remove();
          map = null;
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      observer?.disconnect();
      if (map) {
        window.removeEventListener("resize", map._fiberResize);
        map.remove();
      }
      markers.current.clear();
      routeLayers.current.clear();
    };
  }, [retry]);

  useEffect(() => {
    if (!engine) return;
    const { L, clusters } = engine;
    clusters.clearLayers();
    markers.current.clear();
    const layers = points.map((node) => {
      const marker = L.marker(
        [node.coordinates.latitude, node.coordinates.longitude],
        {
          title: `${MAP_TYPES[node.kind].label} · ${node.name}`,
          alt: `${MAP_TYPES[node.kind].label} · ${node.name}`,
          keyboard: true,
          icon: L.icon({
            iconUrl: MAP_ICONS[node.kind],
            iconSize: [34, 34],
            iconAnchor: [17, 17],
            popupAnchor: [0, -16],
            className: "network-map-marker",
          }),
        },
      );
      marker.bindPopup(
        () =>
          pointPopup(node, (key) => {
            viewport.current?.close();
            callback.current(key);
          }),
        {
          minWidth: 190,
          maxWidth: 310,
          autoPan: true,
        },
      );
      marker.on("click", () => callback.current(node.key));
      markers.current.set(node.key, marker);
      return marker;
    });
    clusters.addLayers(layers);
    return () => {
      clusters.clearLayers();
      markers.current.clear();
    };
  }, [engine, points]);

  useEffect(() => {
    if (!engine) return;
    const { map, L } = engine;
    map.invalidateSize({ pan: false });
    const bounds = L.latLngBounds(
      points.map((n) => [n.coordinates.latitude, n.coordinates.longitude]),
    );
    for (const route of routes) {
      const [w, s, e, n] = route.bounds;
      bounds.extend([s, w]);
      bounds.extend([n, e]);
    }
    if (bounds.isValid())
      map.fitBounds(bounds, { padding: [35, 35], maxZoom: 16, animate: false });
    else map.setView([0, 115], 4, { animate: false }); // Ikhtisar, bukan koordinat perangkat.
  }, [engine, points, routes, fitRevision]);

  useEffect(() => {
    if (!engine) return;
    const { L, routeLayer, routeRenderer } = engine;
    routeLayer.clearLayers();
    routeLayers.current.clear();
    for (const route of routes) {
      const layer = L.polyline(
        route.coordinates.map(([lon, lat]) => [lat, lon]),
        {
          renderer: routeRenderer,
          color: route.color,
          weight: 3.5,
          opacity: 0.92,
          smoothFactor: 1.5,
          lineCap: "round",
          lineJoin: "round",
        },
      );
      layer.bindPopup(
        () =>
          routePopup(route, (item) => {
            viewport.current?.close();
            routeCallback.current?.(item);
          }),
        { maxWidth: 330 },
      );
      layer.bindTooltip(() => textElement("span", route.name), {
        sticky: true,
      });
      layer.on("click", () => routeCallback.current?.(route));
      layer.addTo(routeLayer);
      routeLayers.current.set(route.id, layer);
    }
    return () => {
      routeLayer.clearLayers();
      routeLayers.current.clear();
    };
  }, [engine, routes]);
  useEffect(() => {
    if (!engine || !routeFocus?.bounds) return;
    const [w, s, e, n] = routeFocus.bounds;
    engine.map.fitBounds(
      [
        [s, w],
        [n, e],
      ],
      { padding: [35, 35], maxZoom: 17, animate: false },
    );
  }, [engine, routeFocus]);
  useEffect(() => {
    for (const [id, layer] of routeLayers.current)
      layer.setStyle({
        weight: id === selectedRouteId ? 6 : 3.5,
        opacity: id === selectedRouteId ? 1 : 0.92,
      });
  }, [engine, routes, selectedRouteId]);

  useEffect(() => {
    if (!engine || !focus) return;
    let active = true,
      frame;
    const marker = markers.current.get(focus.key);
    if (marker)
      engine.clusters.zoomToShowLayer(marker, () => {
        // animate:false dapat memanggil callback saat zoomend masih berlangsung.
        // Spiderfy di frame berikutnya agar zoomend tidak langsung menutup grup kolokasi.
        frame = requestAnimationFrame(() => {
          if (!active) return;
          const parent = engine.clusters.getVisibleParent(marker);
          if (
            parent &&
            parent !== marker &&
            typeof parent.spiderfy === "function"
          )
            parent.spiderfy();
          marker.openPopup();
          marker.getElement()?.classList.add("network-map-selected");
        });
      });
    return () => {
      active = false;
      if (frame) cancelAnimationFrame(frame);
      marker?.getElement()?.classList.remove("network-map-selected");
    };
  }, [engine, focus, points]);

  useEffect(() => {
    if (!engine) return;
    setTileError(false);
    if (!basemap) return;
    setLowerResolution(false);
    const tiles = createSatelliteLayer(engine.L, {
      onFallback: () => setLowerResolution(true),
    });
    const onTileError = () => setTileError(true);
    tiles.on("tileerror", onTileError);
    tiles.addTo(engine.map);
    return () => {
      // Listener internal remove Leaflet tetap aktif untuk membersihkan zoom/move.
      tiles.off("tileerror", onTileError);
      tiles.remove();
    };
  }, [engine, basemap]);

  useEffect(() => {
    if (!engine) return;
    const update = () => setMapZoom(engine.map.getZoom());
    update();
    engine.map.on("zoomend", update);
    return () => engine.map.off("zoomend", update);
  }, [engine]);

  return (
    <MapViewport
      ref={viewport}
      ready={!!engine && !error}
      pointCount={points.length}
      routeCount={routes.length}
      onResize={() => engine?.map.invalidateSize({ animate: false })}
    >
      <div
        ref={container}
        className="network-map-canvas"
        role="region"
        aria-label="Peta geografis OLT ODC ODP"
        aria-busy={!engine && !error}
        data-marker-count={engine ? points.length : 0}
        data-connection-count="0"
        data-map-zoom={mapZoom}
        data-route-count={engine ? routes.length : 0}
      />
      {!engine && !error && (
        <div className="network-map-notice" role="status">
          Menyiapkan peta…
        </div>
      )}
      {error && (
        <div className="network-map-notice" role="alert">
          <p>Kanvas peta belum tersedia: {error}</p>
          <p>Daftar koordinat dan ekspor KMZ tetap dapat digunakan.</p>
          <button
            className="btn mt-2"
            onClick={() => {
              setEngine(null);
              setRetry((n) => n + 1);
            }}
          >
            Coba muat peta lagi
          </button>
        </div>
      )}
      {engine &&
        !error &&
        (!basemap ||
          tileError ||
          lowerResolution ||
          mapZoom > SATELLITE_NATIVE_ZOOM) && (
          <div className="network-map-notice pointer-events-none" role="status">
            {tileError
              ? SATELLITE_ERROR
              : !basemap
                ? "Citra satelit nonaktif · titik dan jalur tetap mengikuti koordinat sumber."
                : SATELLITE_DETAIL_NOTICE}
          </div>
        )}
      {engine && !points.length && !routes.length && (
        <div className="network-map-empty pointer-events-none">
          Belum ada titik perangkat atau jalur impor pada tampilan ini.
        </div>
      )}
    </MapViewport>
  );
}
