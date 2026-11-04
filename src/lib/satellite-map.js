// Tidak memuat Leaflet/jaringan sampai halaman peta benar-benar dibuka.
export const MAP_MAX_ZOOM = 22;
export const SATELLITE_NATIVE_ZOOM = 19;
export const SATELLITE_FALLBACK_STEPS = 2;
export const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false";
export const SATELLITE_OPTIONS = Object.freeze({
  maxZoom: MAP_MAX_ZOOM,
  maxNativeZoom: SATELLITE_NATIVE_ZOOM,
  noWrap: true,
  updateWhenIdle: true,
  updateWhenZooming: false,
  keepBuffer: 1,
  referrerPolicy: "strict-origin-when-cross-origin",
  attribution:
    'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
});
export const SATELLITE_ERROR =
  "Sebagian citra satelit gagal dimuat. Titik, jalur impor, detail, dan KMZ tetap tersedia.";
export const SATELLITE_DETAIL_NOTICE =
  "Citra diperbesar dari resolusi yang tersedia; zoom lebih dekat tidak menambah ketajaman atau akurasi GPS.";

// Satu petak anak harus memakai potongan yang benar dari petak induk,
// bukan meregangkan seluruh induk ke masing-masing anak (yang akan menggeser citra).
export function satelliteTileSource(coords, level = coords.z) {
  const { x, y, z } = coords;
  if (
    ![x, y, z, level].every(Number.isInteger) ||
    z < 0 ||
    z > SATELLITE_NATIVE_ZOOM ||
    level < 0 ||
    level > z ||
    x < 0 ||
    y < 0 ||
    x >= 2 ** z ||
    y >= 2 ** z
  )
    throw new Error("Koordinat tile satelit tidak valid.");
  const scale = 2 ** (z - level);
  const column = Math.floor(x / scale),
    row = Math.floor(y / scale);
  return {
    url: SATELLITE_TILE_URL.replace("{z}", level)
      .replace("{y}", row)
      .replace("{x}", column),
    size: 256 * scale,
    left: (column * scale - x) * 256,
    top: (row * scale - y) * 256,
  };
}

// GridLayer sudah mengatur overzoom: kamera dapat mencapai 22, request tetap <=19.
// blankTile=false meminta error, bukan gambar abu-abu "Map data not yet available".
// Fallback per tile dibatasi dua tingkat; tanpa polling, CORS fetch, canvas piksel,
// tilemap API tambahan, atau penurunan zoom/pemindahan titik perangkat.
export function createSatelliteLayer(L, { onFallback } = {}) {
  const layer = L.gridLayer(SATELLITE_OPTIONS);
  layer.createTile = function (coords, done) {
    const tile = document.createElement("div");
    tile.className = "network-map-satellite-tile";
    tile.style.overflow = "hidden";
    let active = true,
      settled = false,
      currentImage;
    const minimum = Math.max(2, coords.z - SATELLITE_FALLBACK_STEPS);
    function load(level) {
      const source = satelliteTileSource(coords, level);
      const image = document.createElement("img");
      currentImage = image;
      image.alt = "";
      image.draggable = false;
      image.decoding = "async";
      image.referrerPolicy = SATELLITE_OPTIONS.referrerPolicy;
      Object.assign(image.style, {
        position: "absolute",
        pointerEvents: "none",
        maxWidth: "none",
        maxHeight: "none",
        width: `${source.size}px`,
        height: `${source.size}px`,
        left: `${source.left}px`,
        top: `${source.top}px`,
      });
      const clear = () => {
        image.onload = null;
        image.onerror = null;
      };
      image.onload = () => {
        if (!active || settled || currentImage !== image) return;
        settled = true;
        clear();
        tile.dataset.satelliteRequestedZoom = String(coords.z);
        tile.dataset.satelliteSourceZoom = String(level);
        if (level < coords.z) onFallback?.();
        done(null, tile);
      };
      image.onerror = () => {
        if (!active || settled || currentImage !== image) return;
        clear();
        if (level > minimum) {
          image.remove();
          load(level - 1);
        } else {
          settled = true;
          image.remove();
          done(new Error(SATELLITE_ERROR), tile);
        }
      };
      tile.append(image);
      image.src = source.url;
    }
    tile._fiberCancelSatellite = () => {
      active = false;
      if (!currentImage) return;
      currentImage.onload = null;
      currentImage.onerror = null;
      currentImage.removeAttribute("src");
      currentImage.remove();
    };
    load(coords.z);
    return tile;
  };
  layer.on("tileunload", ({ tile }) => tile._fiberCancelSatellite?.());
  return layer;
}
