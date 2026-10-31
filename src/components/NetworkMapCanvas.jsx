import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { MAP_ICONS } from "../lib/map-icons.js";
import { MAP_TYPES, SCHEMATIC_NOTICE } from "../lib/network-map.js";
import { coordinateText } from "../lib/coordinates.js";

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
      `${MAP_TYPES[node.kind].label} #${node.id} · ${coordinateText(node.coordinates)}`,
    ),
    textElement("p", node.location || "Lokasi/alamat belum diisi."),
  );
  const button = textElement("button", "Lihat detail", "btn text-xs");
  button.type = "button";
  button.addEventListener("click", () => onSelect(node.key));
  content.append(button);
  return content;
}
function connectionPopup(edge) {
  const content = textElement("div", "", "network-map-popup");
  content.append(
    textElement("strong", `${edge.from.name} → ${edge.to.name}`),
    textElement("p", SCHEMATIC_NOTICE),
  );
  if (edge.review)
    content.append(
      textElement(
        "p",
        edge.reviewReasons?.join("; ") ||
          "Receiver belum dipilih/valid; verifikasi di Mapping Core.",
      ),
    );
  const list = document.createElement("ul");
  edge.evidence.forEach((item) => list.append(textElement("li", item)));
  content.append(list);
  return content;
}

export default function NetworkMapCanvas({
  points,
  lines,
  focus,
  fitRevision,
  showConnections,
  basemap,
  onSelect,
}) {
  const container = useRef(null),
    markers = useRef(new Map()),
    callback = useRef(onSelect);
  callback.current = onSelect;
  const [engine, setEngine] = useState(null),
    [error, setError] = useState(""),
    [tileError, setTileError] = useState(false),
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
            maxZoom: 19,
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
              weight: 1,
              color: "#94a3b8",
              opacity: 0.5,
              dashArray: "2 5",
            },
            iconCreateFunction: (cluster) =>
              L.divIcon({
                html: `<span>${Number(cluster.getChildCount())}<span class="sr-only"> perangkat; klik untuk membuka grup</span></span>`,
                className: "network-map-cluster",
                iconSize: [38, 38],
              }),
          });
          clusters.addTo(map);
          const lineLayer = L.layerGroup().addTo(map);
          const resize = () => map.invalidateSize({ pan: false });
          if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(resize);
            observer.observe(container.current);
          }
          map._fiberResize = resize;
          window.addEventListener("resize", resize);
          setEngine({ L, map, clusters, lineLayer });
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
      marker.bindPopup(() => pointPopup(node, (key) => callback.current(key)), {
        maxWidth: 310,
        autoPan: true,
      });
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
    if (points.length)
      map.fitBounds(
        L.latLngBounds(
          points.map((n) => [n.coordinates.latitude, n.coordinates.longitude]),
        ),
        { padding: [35, 35], maxZoom: 16, animate: false },
      );
    else map.setView([0, 115], 4, { animate: false }); // Ikhtisar, bukan koordinat perangkat.
  }, [engine, points, fitRevision]);

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
    const { L, lineLayer } = engine;
    lineLayer.clearLayers();
    if (showConnections)
      lines.forEach((edge) => {
        L.polyline(
          [
            [edge.from.coordinates.latitude, edge.from.coordinates.longitude],
            [edge.to.coordinates.latitude, edge.to.coordinates.longitude],
          ],
          {
            color: edge.review ? "#f59e0b" : MAP_TYPES[edge.from.kind].color,
            weight: 2.5,
            opacity: 0.75,
            dashArray: "6 6",
          },
        )
          .bindPopup(() => connectionPopup(edge), { maxWidth: 340 })
          .addTo(lineLayer);
      });
    return () => lineLayer.clearLayers();
  }, [engine, lines, showConnections]);

  useEffect(() => {
    if (!engine) return;
    setTileError(false);
    if (!basemap) return;
    const tiles = engine.L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        noWrap: true,
        updateWhenIdle: true,
        keepBuffer: 1,
        referrerPolicy: "strict-origin-when-cross-origin",
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
      },
    );
    tiles.on("tileerror", () => setTileError(true));
    tiles.addTo(engine.map);
    return () => {
      tiles.off();
      tiles.remove();
    };
  }, [engine, basemap]);

  return (
    <div className="network-map-shell">
      <div
        ref={container}
        className="network-map-canvas"
        role="region"
        aria-label="Peta geografis OLT ODC ODP"
        aria-busy={!engine && !error}
        data-marker-count={engine ? points.length : 0}
        data-connection-count={engine && showConnections ? lines.length : 0}
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
      {engine && !error && (!basemap || tileError) && (
        <div className="network-map-notice pointer-events-none" role="status">
          {tileError
            ? "Peta dasar gagal dimuat. Titik, detail, dan KMZ tetap tersedia."
            : "Peta dasar nonaktif · titik sesuai koordinat, tanpa detail jalan."}
        </div>
      )}
      {engine && !points.length && (
        <div className="network-map-empty pointer-events-none">
          Tidak ada koordinat valid pada tampilan ini.
        </div>
      )}
    </div>
  );
}
