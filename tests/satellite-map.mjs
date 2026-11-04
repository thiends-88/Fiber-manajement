import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  MAP_MAX_ZOOM,
  SATELLITE_NATIVE_ZOOM,
  SATELLITE_FALLBACK_STEPS,
  SATELLITE_OPTIONS,
  SATELLITE_TILE_URL,
  SATELLITE_ERROR,
  satelliteTileSource,
  createSatelliteLayer,
} from "../src/lib/satellite-map.js";
const dom = new JSDOM("<!doctype html><html><body></body></html>");
const oldDocument = globalThis.document;
globalThis.document = dom.window.document;
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("OK   ", name);
}
const event = (image, name) => image.dispatchEvent(new dom.window.Event(name));
function fixture() {
  const handlers = new Map(),
    notices = [],
    done = [];
  const L = {
    gridLayer(options) {
      return {
        options,
        on(name, fn) {
          handlers.set(name, fn);
        },
      };
    },
  };
  const layer = createSatelliteLayer(L, {
    onFallback: () => notices.push(true),
  });
  const tile = layer.createTile({ x: 5, y: 6, z: 19 }, (...args) =>
    done.push(args),
  );
  return {
    layer,
    tile,
    done,
    notices,
    unload: () => handlers.get("tileunload")({ tile }),
  };
}
try {
  check(
    "zoom kamera 22 terpisah dari citra native 19; viewport/buffer tetap hemat",
    () => {
      assert.equal(MAP_MAX_ZOOM, 22);
      assert.equal(SATELLITE_NATIVE_ZOOM, 19);
      assert.equal(SATELLITE_OPTIONS.maxZoom, 22);
      assert.equal(SATELLITE_OPTIONS.maxNativeZoom, 19);
      assert.ok(Object.isFrozen(SATELLITE_OPTIONS));
      assert.equal(SATELLITE_OPTIONS.keepBuffer, 1);
      assert.equal(SATELLITE_OPTIONS.updateWhenIdle, true);
      assert.equal(SATELLITE_OPTIONS.updateWhenZooming, false);
      assert.equal(SATELLITE_OPTIONS.noWrap, true);
      assert.match(SATELLITE_OPTIONS.attribution, /Esri.*Maxar.*Earthstar/);
      assert.equal(SATELLITE_FALLBACK_STEPS, 2);
    },
  );
  check(
    "Esri z/row/column meminta blankTile=false, bukan placeholder HTTP 200",
    () => {
      assert.equal(
        SATELLITE_TILE_URL,
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false",
      );
      const url = new URL(satelliteTileSource({ x: 5, y: 6, z: 19 }).url);
      assert.equal(
        url.pathname,
        "/ArcGIS/rest/services/World_Imagery/MapServer/tile/19/6/5",
      );
      assert.deepEqual([...url.searchParams], [["blankTile", "false"]]);
      for (const coords of [
        { x: -1, y: 0, z: 19 },
        { x: 2 ** 19, y: 0, z: 19 },
        { x: 0, y: 0, z: 22 },
        { x: 0, y: Infinity, z: 4 },
      ])
        assert.throws(() => satelliteTileSource(coords));
      assert.throws(() => satelliteTileSource({ x: 5, y: 6, z: 19 }, 20));
    },
  );
  check(
    "potongan tile induk mempertahankan lokasi semua kuadran, bukan menggeser citra",
    () => {
      const source = satelliteTileSource({ x: 5, y: 6, z: 19 }, 18);
      assert.match(source.url, /tile\/18\/3\/2\?blankTile=false$/);
      assert.equal(source.size, 512);
      assert.equal(source.left, -256);
      assert.equal(source.top, 0);
      const parent = satelliteTileSource({ x: 5, y: 6, z: 19 }, 17);
      assert.match(parent.url, /tile\/17\/1\/1\?blankTile=false$/);
      assert.equal(parent.size, 1024);
      assert.equal(parent.left, -256);
      assert.equal(parent.top, -512);
    },
  );
  check(
    "tile sukses hanya satu gambar/request, tanpa fallback atau fetch API tambahan",
    () => {
      const f = fixture(),
        image = f.tile.querySelector("img");
      assert.equal(image.style.width, "256px");
      assert.equal(image.referrerPolicy, "strict-origin-when-cross-origin");
      assert.equal(image.getAttribute("crossorigin"), null);
      event(image, "load");
      assert.equal(f.done.length, 1);
      assert.equal(f.done[0][0], null);
      assert.equal(f.notices.length, 0);
      assert.equal(f.tile.dataset.satelliteSourceZoom, "19");
    },
  );
  check(
    "tile tidak tersedia mengambil satu induk dan memotong kuadran yang tepat",
    () => {
      const f = fixture();
      event(f.tile.querySelector("img"), "error");
      const image = f.tile.querySelector("img");
      assert.match(image.src, /tile\/18\/3\/2\?blankTile=false$/);
      assert.equal(image.style.width, "512px");
      assert.equal(image.style.left, "-256px");
      assert.equal(image.style.top, "0px");
      event(image, "load");
      assert.equal(f.done.length, 1);
      assert.equal(f.done[0][0], null);
      assert.equal(f.notices.length, 1);
      assert.equal(f.tile.dataset.satelliteSourceZoom, "18");
      assert.equal(f.tile.dataset.satelliteRequestedZoom, "19");
    },
  );
  check(
    "semua tile gagal berhenti setelah native+dua induk, bukan loop/retry massal",
    () => {
      const f = fixture(),
        levels = [];
      while (f.tile.querySelector("img")) {
        const image = f.tile.querySelector("img");
        levels.push(Number(new URL(image.src).pathname.split("/").at(-3)));
        assert.ok(levels.length <= 3);
        event(image, "error");
      }
      assert.deepEqual(levels, [19, 18, 17]);
      assert.equal(f.done.length, 1);
      assert.equal(f.done[0][0].message, SATELLITE_ERROR);
      assert.equal(f.notices.length, 0);
    },
  );
  check("zoom global minimum tidak menurunkan request di bawah level 2", () => {
    const f = fixture(),
      done = [];
    const tile = f.layer.createTile({ x: 1, y: 1, z: 2 }, (...args) =>
      done.push(args),
    );
    event(tile.querySelector("img"), "error");
    assert.equal(tile.querySelectorAll("img").length, 0);
    assert.equal(done.length, 1);
  });
  check(
    "hide/unmount membatalkan gambar pending dan menolak callback terlambat",
    () => {
      const f = fixture(),
        image = f.tile.querySelector("img"),
        load = image.onload,
        error = image.onerror;
      f.unload();
      assert.equal(image.getAttribute("src"), null);
      assert.equal(image.onload, null);
      assert.equal(image.onerror, null);
      load();
      error();
      assert.equal(f.done.length, 0);
      assert.equal(f.notices.length, 0);
      assert.equal(f.tile.querySelectorAll("img").length, 0);
    },
  );
  check(
    "callback gambar lama tidak menggandakan fallback/hasil setelah induk selesai",
    () => {
      const f = fixture(),
        first = f.tile.querySelector("img"),
        stale = first.onerror;
      event(first, "error");
      const second = f.tile.querySelector("img");
      stale();
      assert.equal(f.tile.querySelector("img"), second);
      const loaded = second.onload;
      event(second, "load");
      loaded();
      stale();
      assert.equal(f.done.length, 1);
      assert.equal(f.notices.length, 1);
    },
  );
  check("fallback satu tile tidak mengubah resolusi/isi tile tetangga", () => {
    const f = fixture(),
      otherDone = [];
    const other = f.layer.createTile({ x: 6, y: 6, z: 19 }, (...args) =>
      otherDone.push(args),
    );
    event(f.tile.querySelector("img"), "error");
    event(f.tile.querySelector("img"), "load");
    assert.match(
      other.querySelector("img").src,
      /tile\/19\/6\/6\?blankTile=false$/,
    );
    event(other.querySelector("img"), "load");
    assert.equal(other.dataset.satelliteSourceZoom, "19");
    assert.equal(otherDone.length, 1);
    assert.equal(f.layer.options.maxNativeZoom, 19);
  });
  console.log(`\nSATELIT / OVERZOOM / FALLBACK: ${passed} pemeriksaan lulus.`);
} finally {
  globalThis.document = oldDocument;
  dom.window.close();
}
