// Semua geometri berikut sintetis. Berkas jaringan pengguna tidak disertakan di repository.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { parseRouteFile } from "../src/lib/route-import.js";
import {
  validateRouteImport,
  ROUTE_LIMITS,
  routeColor,
} from "../src/lib/cable-routes.js";
import { createCableRouteStore } from "../server/cable-routes.mjs";
import { buildKml, createKmz } from "../src/lib/kmz.js";
import fs from "node:fs";
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("OK   ", name);
}
const encode = strToU8;
const parse = (text, name = "uji.kml") => parseRouteFile(encode(text), name);
const wrap = (body) =>
  `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;
const mark = (body, name = "Segmen sintetis") =>
  `<Placemark><name>${name}</name>${body}</Placemark>`;
const line = (points = "10,-5,0 10.001,-5.002,3 10.003,-5.001,0") =>
  `<LineString><coordinates>${points}</coordinates></LineString>`;
const csv =
  'Name,Type,Coordinates,Description\r\n"ADSS fiktif",line,"10,-5;10.01,-5.01;10.02,-5.015","catatan, dengan koma"\r\n"ADSS fiktif",line,"10.02,-5.015;10.03,-5.02","kutip ""aman""\nbaris dua"\r\n';
const fixture = () => parse(csv, "uji.xml.csv");
check(
  "CSV BOM/CRLF, kutip koma/newline dan ekstensi ganda dibaca berdasarkan isi",
  () => {
    const result = parse("\ufeff" + csv, "uji.xml.csv");
    assert.equal(result.source_format, "CSV");
    assert.equal(result.name, "uji");
    assert.equal(result.route_count, 2);
    assert.equal(result.vertex_count, 5);
    assert.equal(result.routes[1].description, 'kutip "aman"\nbaris dua');
  },
);
check(
  "nama sama tetap dua segmen; warna stabil, tidak menggabungkan kabel/core",
  () => {
    const result = fixture();
    assert.equal(result.routes.length, 2);
    assert.equal(result.routes[0].name, result.routes[1].name);
    assert.equal(routeColor("ABC"), routeColor("abc"));
  },
);
check(
  "CSV kosong, header ganda/tidak lengkap dan kolom bergeser ditolak",
  () => {
    for (const text of [
      "",
      'Name,Name,Type,Coordinates\na,a,line,"1,2;2,3"',
      "Name,Type\na,line",
      'Name,Type,Coordinates\na,line,"1,2;2,3",extra',
    ])
      assert.throws(() => parse(text, "uji.csv"));
  },
);
check(
  "kutip CSV rusak dan karakter setelah penutup tidak diterima diam-diam",
  () => {
    for (const text of [
      'Name,Type,Coordinates\n"a,line,"1,2;2,3"',
      'Name,Type,Coordinates\n"a"b,line,"1,2;2,3"',
    ])
      assert.throws(() => parse(text, "uji.csv"));
  },
);
check(
  "record point CSV diabaikan dengan peringatan, bukan menjadi inventaris",
  () => {
    const result = parse(csv + 'ODP palsu,point,"10,-5",\r\n', "uji.csv");
    assert.equal(result.route_count, 2);
    assert.match(result.warnings[0], /1 record/);
  },
);
check(
  "CSV hanya point, koordinat kosong, bukan angka, sumbu salah dan garis nol ditolak",
  () => {
    for (const coords of [
      "",
      "100,200;101,201",
      "NaN,0;1,2",
      "1,2;1,2",
      "1,2;",
      "1,2,3,4;2,3",
    ])
      assert.throws(() =>
        parse(`Name,Type,Coordinates\na,line,"${coords}"`, "uji.csv"),
      );
    assert.throws(
      () => parse('Name,Type,Coordinates\na,point,"10,-5"', "uji.csv"),
      /Tidak ada garis/,
    );
  },
);
check(
  "KML folder, MultiGeometry, nama UTF8 dan altitude asli dipertahankan",
  () => {
    const result = parse(
      wrap(
        `<Folder><name>Wilayah uji</name>${mark(`<MultiGeometry>${line()}${line("11,-4 11.01,-4.02")}</MultiGeometry>`, "Jalur &amp; cabang 🌏")}</Folder>`,
      ),
    );
    assert.equal(result.route_count, 2);
    assert.equal(result.routes[0].folder, "Wilayah uji");
    assert.equal(result.routes[0].name, "Jalur & cabang 🌏");
    assert.deepEqual(result.routes[0].coordinates[1], [10.001, -5.002, 3]);
  },
);
check("namespace prefix KML juga dikenali", () => {
  const result = parse(
    '<k:kml xmlns:k="http://www.opengis.net/kml/2.2"><k:Placemark><k:LineString><k:coordinates>10,-5 11,-6</k:coordinates></k:LineString></k:Placemark></k:kml>',
  );
  assert.equal(result.route_count, 1);
});
check(
  "Style/StyleMap normal lokal, termasuk deklarasi setelah garis, diubah ABGR→RGB",
  () => {
    const result = parse(
      wrap(
        mark("<styleUrl>#map</styleUrl>" + line()) +
          '<StyleMap id="map"><Pair><key>normal</key><styleUrl>#color</styleUrl></Pair></StyleMap><Style id="color"><LineStyle><color>ff332211</color></LineStyle></Style>',
      ),
    );
    assert.equal(result.routes[0].color, "#112233");
  },
);
check("inline warna mengalahkan Style lokal", () => {
  const result = parse(
    wrap(
      mark(
        "<Style><LineStyle><color>ff00ff00</color></LineStyle></Style>" +
          line(),
      ),
    ),
  );
  assert.equal(result.routes[0].color, "#00ff00");
});
check(
  "Point/Polygon/Track/NetworkLink tidak diunduh atau dipromosikan menjadi kabel",
  () => {
    const result = parse(
      wrap(
        mark(line()) +
          "<NetworkLink><Link><href>https://private.invalid/net.kml</href></Link></NetworkLink>" +
          mark("<Point><coordinates>10,-5</coordinates></Point>") +
          mark("<Polygon/>") +
          '<gx:Track xmlns:gx="http://www.google.com/kml/ext/2.2"/>',
      ),
    );
    assert.equal(result.route_count, 1);
    assert.ok(result.warnings.some((w) => w.includes("NetworkLink")));
    assert.ok(result.warnings.some((w) => w.includes("Track")));
  },
);
check("style remote tidak menjadi permintaan jaringan", () => {
  const result = parse(
    wrap(
      mark("<styleUrl>https://private.invalid/style.kml#a</styleUrl>" + line()),
    ),
  );
  assert.ok(result.warnings.some((w) => w.includes("Style eksternal")));
});
check("XML rusak, namespace asing, DOCTYPE dan XXE ditolak", () => {
  for (const text of [
    "<kml><Placemark>",
    '<x xmlns="urn:unknown"/>',
    '<!DOCTYPE kml [<!ENTITY x "foo">]><kml/>',
    '<!DOCTYPE kml SYSTEM "file:///etc/passwd"><kml/>',
    "<kml/><kml/>",
  ])
    assert.throws(() => parse(text));
});
check("kedalaman XML dibatasi", () =>
  assert.throws(
    () =>
      parse(
        wrap("<Folder>".repeat(65) + mark(line()) + "</Folder>".repeat(65)),
      ),
    /dalam/,
  ),
);
check(
  "garis tanpa Placemark/koordinat dan koordinat tidak finite ditolak",
  () => {
    for (const body of [
      line(),
      mark("<LineString/>"),
      mark(line("10,-5 Infinity,-4")),
    ])
      assert.throws(() => parse(wrap(body)));
  },
);
check(
  "deskripsi HTML/CDATA dipertahankan sebagai teks, tidak dieksekusi",
  () => {
    const result = parse(
      wrap(
        mark(
          "<description><![CDATA[<img src=x onerror=alert(1)>]]></description>" +
            line(),
        ),
      ),
    );
    assert.equal(result.routes[0].description, "<img src=x onerror=alert(1)>");
  },
);
check("batas berkas 3MB ditegakkan sebelum parsing", () =>
  assert.throws(
    () =>
      parseRouteFile(new Uint8Array(ROUTE_LIMITS.fileBytes + 1), "besar.kmz"),
    /3 MB/,
  ),
);
check("KMZ sungguhan dibaca, ikon/aset asing tidak diekstrak", () => {
  const bytes = zipSync({
    "doc.kml": encode(wrap(mark(line()))),
    "icons/a.png": new Uint8Array([1, 2]),
    "../../unused.txt": encode("not read"),
  });
  const result = parseRouteFile(bytes, "uji.kmz");
  assert.equal(result.source_format, "KMZ");
  assert.equal(result.vertex_count, 3);
});
check(
  "KMZ satu KML bernama lain dibaca; multi KML ambigu tanpa doc ditolak",
  () => {
    assert.equal(
      parseRouteFile(
        zipSync({ "folder/uji.kml": encode(wrap(mark(line()))) }),
        "uji.kmz",
      ).route_count,
      1,
    );
    assert.throws(
      () =>
        parseRouteFile(
          zipSync({
            "a.kml": encode(wrap(mark(line()))),
            "b.kml": encode(wrap(mark(line()))),
          }),
          "uji.kmz",
        ),
      /doc.kml/,
    );
  },
);
check(
  "KML tambahan di KMZ diberi catatan, tidak dianggap lengkap secara diam-diam",
  () => {
    const result = parseRouteFile(
      zipSync({
        "doc.kml": encode(wrap(mark(line()))),
        "lain.kml": encode(wrap(mark(line()))),
      }),
      "uji.kmz",
    );
    assert.ok(result.warnings.some((w) => w.includes("KML selain")));
  },
);
check("doc.KML ganda/ambigu dan ZIP rusak ditolak", () => {
  assert.throws(
    () =>
      parseRouteFile(
        zipSync({
          "doc.kml": encode(wrap(mark(line()))),
          "DOC.KML": encode(wrap(mark(line()))),
        }),
        "uji.kmz",
      ),
    /ganda/,
  );
  assert.throws(() =>
    parseRouteFile(new Uint8Array([80, 75, 1, 2]), "rusak.kmz"),
  );
});
check(
  "zip bomb kecil terkompresi ditolak dari ukuran asli sebelum inflate",
  () => {
    const bytes = zipSync({
      "doc.kml": new Uint8Array(ROUTE_LIMITS.xmlBytes + 1),
    });
    assert.ok(bytes.length < ROUTE_LIMITS.fileBytes);
    assert.throws(() => parseRouteFile(bytes, "besar.kmz"), /8 MB/);
  },
);
check(
  "batas segmen dan vertex, range, tipe data dan warna juga ditegakkan validator server",
  () => {
    const base = fixture();
    for (const routes of [
      [...Array(501)].map(() => base.routes[0]),
      [
        {
          ...base.routes[0],
          coordinates: [...Array(20001)].map((_, i) => [10 + i / 1e6, -5]),
        },
      ],
      [
        {
          ...base.routes[0],
          coordinates: [
            ["10", -5],
            [11, -5],
          ],
        },
      ],
      [{ ...base.routes[0], color: "url(evil)" }],
    ])
      assert.throws(() => validateRouteImport({ ...base, routes }));
  },
);
check("nol eksplisit valid, tidak ada fallback untuk posisi kosong", () => {
  const result = validateRouteImport({
    ...fixture(),
    routes: [
      {
        name: "Nol eksplisit",
        coordinates: [
          [0, 0],
          [0.001, 0],
        ],
        color: "#abcdef",
      },
    ],
  });
  assert.deepEqual(result.bounds, [0, 0, 0.001, 0]);
  assert.throws(() =>
    validateRouteImport({
      ...fixture(),
      routes: [{ name: "Kosong", coordinates: [] }],
    }),
  );
});
check(
  "nama file dibatasi ke basename, nama/deskripsi panjang dan mode sumber invalid ditolak",
  () => {
    const base = fixture();
    assert.equal(
      validateRouteImport({ ...base, source_name: "../../uji.csv" })
        .source_name,
      "uji.csv",
    );
    for (const change of [
      { name: "" },
      { name: "x".repeat(161) },
      { source_format: "EXE" },
      { routes: [{ ...base.routes[0], description: "x".repeat(2001) }] },
    ])
      assert.throws(() => validateRouteImport({ ...base, ...change }));
  },
);
const db = new DatabaseSync(":memory:");
db.exec(
  "PRAGMA foreign_keys=ON; CREATE TABLE users (id INTEGER PRIMARY KEY, password_hash TEXT); INSERT INTO users VALUES(1,'private-fixture'); CREATE TABLE olts(id INTEGER PRIMARY KEY, name TEXT, asset_tag TEXT); INSERT INTO olts VALUES(8,'fixture','legacy')",
);
const atomic = (fn) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
};
let store = createCableRouteStore(db, atomic),
  first;
const inventory = () =>
  JSON.stringify({
    users: db.prepare("SELECT * FROM users").all(),
    olts: db.prepare("SELECT * FROM olts").all(),
  });
const before = inventory();
check(
  "tabel baru kosong; startup tidak menambahkan koordinat/perangkat",
  () => {
    assert.deepEqual(store.index(), { version: 1, imports: [] });
    assert.equal(inventory(), before);
  },
);
check(
  "simpan batch/segmen atomik dengan ID stabil; nama sama bukan deduplikasi",
  () => {
    first = store.create(fixture());
    const geo = store.geometry(first.id);
    assert.equal(geo.routes.length, 2);
    assert.notEqual(geo.routes[0].id, geo.routes[1].id);
    assert.deepEqual(
      geo.routes[0].coordinates,
      fixture().routes[0].coordinates,
    );
    assert.equal(inventory(), before);
  },
);
check(
  "index ringan tidak mengandung array koordinat, description atau akun",
  () => {
    const index = store.index();
    assert.equal(index.imports[0].vertex_count, 5);
    const raw = JSON.stringify(index);
    for (const key of [
      "coordinates",
      "password_hash",
      "private-fixture",
      "description",
    ])
      assert.ok(!raw.includes(key));
  },
);
check(
  "duplikat konten, termasuk ganti nama berkas, ditolak 409 tanpa menambah row",
  () => {
    assert.throws(
      () =>
        store.create({
          ...fixture(),
          name: "nama baru",
          source_name: "copy.csv",
        }),
      (e) => e.status === 409,
    );
    assert.equal(store.index().imports.length, 1);
  },
);
check(
  "restart/migrasi idempoten mempertahankan ID, timestamp dan semua geometri",
  () => {
    const previous = JSON.stringify(store.geometry(first.id));
    store = createCableRouteStore(db, atomic);
    assert.equal(JSON.stringify(store.geometry(first.id)), previous);
    assert.equal(inventory(), before);
  },
);
check("kegagalan segmen kedua rollback metadata dan segmen pertama", () => {
  db.exec(
    "CREATE TRIGGER fail_route BEFORE INSERT ON map_route_segments WHEN NEW.ordinal=2 BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  try {
    assert.throws(
      () =>
        store.create({
          ...fixture(),
          routes: fixture().routes.map((r) => ({
            ...r,
            name: "gagal " + r.name,
          })),
        }),
      /fixture failure/,
    );
    assert.equal(store.index().imports.length, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM map_route_segments").get().n,
      2,
    );
  } finally {
    db.exec("DROP TRIGGER fail_route");
  }
});
check("catatan unsupported geometry tersimpan pada metadata", () => {
  const body = {
    ...fixture(),
    warnings: ["Satu Point diabaikan"],
    routes: fixture().routes.map((r) => ({ ...r, name: "catatan " + r.name })),
  };
  const meta = store.create(body);
  assert.deepEqual(meta.warnings, body.warnings);
  store.remove(meta.id);
});
check(
  "kuota total dicek sebelum menulis, bukan menerima peta tanpa batas",
  () => {
    db.prepare("UPDATE map_route_imports SET vertex_count=? WHERE id=?").run(
      ROUTE_LIMITS.totalVertices,
      first.id,
    );
    try {
      assert.throws(
        () =>
          store.create({
            ...fixture(),
            routes: fixture().routes.map((r) => ({
              ...r,
              name: "baru " + r.name,
            })),
          }),
        (e) => e.status === 409,
      );
      assert.equal(store.index().imports.length, 1);
    } finally {
      db.prepare("UPDATE map_route_imports SET vertex_count=5 WHERE id=?").run(
        first.id,
      );
    }
  },
);
const view = { points: [], lines: [], missing: [] };
let routes = store.geometry(first.id).routes.map((r) => ({
  ...r,
  batch_name: first.name,
  source_name: first.source_name,
  source_format: first.source_format,
}));
check("KMZ dapat berisi hanya jalur saat inventaris belum punya GPS", () => {
  const kml = buildKml(view, {
    includeConnections: false,
    importedRoutes: routes,
  });
  assert.equal((kml.match(/<LineString>/g) || []).length, 2);
  assert.equal((kml.match(/<Point>/g) || []).length, 0);
  assert.ok(kml.includes("10,-5,0 10.01,-5.01,0 10.02,-5.015,0"));
  assert.ok(kml.includes("Jalur kabel impor (2)"));
});
check(
  "ZIP/KML ekspor roundtrip menyimpan semua vertex, nama sama, warna dan catatan asli",
  () => {
    const icons = Object.fromEntries(
      ["olt", "odc", "odp"].map((kind) => [
        kind,
        new Uint8Array(
          fs.readFileSync(
            new URL(`../src/assets/map/${kind}.png`, import.meta.url),
          ),
        ),
      ]),
    );
    const bytes = createKmz(
      view,
      { includeConnections: false, importedRoutes: routes },
      icons,
    );
    const files = unzipSync(bytes);
    assert.ok(files["doc.kml"]);
    const result = parseRouteFile(bytes, "roundtrip.kmz");
    assert.deepEqual(
      result.routes,
      fixture().routes.map((route) => ({
        ...route,
        coordinates: route.coordinates.map((p) => [p[0], p[1], p[2] ?? 0]),
      })),
    );
  },
);
check(
  "metadata ID/HTML di ekspor di-escape dan tidak membuat script/NetworkLink",
  () => {
    const text = buildKml(view, {
      importedRoutes: [
        {
          ...routes[0],
          name: "<img src=x>",
          description: "<script>evil</script> & ]]> token",
          batch_name: "<kumpulan>",
        },
      ],
    });
    assert.ok(!text.includes("<script>"));
    assert.ok(!text.includes("<img src=x>"));
    assert.ok(!text.includes("<NetworkLink>"));
    assert.ok(text.includes("&lt;kumpulan&gt;"));
  },
);
check(
  "ekspor baru tanpa skema; skema KML lama tetap ditolak sebagai kabel",
  () => {
    const point = (key, lon) => ({
      key,
      kind: "olt",
      id: 1,
      name: key,
      coordinates: {
        status: "valid",
        latitude: -5,
        longitude: lon,
        source: "manual",
      },
      oltName: "uji",
    });
    const a = point("a", 10),
      b = point("b", 11);
    const text = buildKml(
      {
        points: [a, b],
        missing: [],
        lines: [
          { key: "a-b", from: a, to: b, evidence: ["fixture"], review: false },
        ],
      },
      { importedRoutes: routes, includeConnections: true },
    );
    assert.equal((text.match(/<LineString>/g) || []).length, 2);
    assert.ok(
      !text.includes('id="connection-') && !text.includes(">schematic<"),
    );
    const legacy = text.replace(
      "</Document>",
      '<Placemark><name>Skema legacy sintetis</name><ExtendedData><Data name="fiber_geometry_kind"><value>schematic</value></Data></ExtendedData><LineString><coordinates>10,-5,0 11,-5,0</coordinates></LineString></Placemark></Document>',
    );
    const result = parse(legacy);
    assert.equal(result.route_count, 2);
    assert.ok(result.warnings.some((w) => w.includes("garis skematis")));
  },
);
check(
  "hapus kumpulan hanya menghapus segmennya, akun/inventaris tetap identik",
  () => {
    store.remove(first.id);
    assert.deepEqual(store.index().imports, []);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM map_route_segments").get().n,
      0,
    );
    assert.equal(inventory(), before);
    assert.throws(
      () => store.geometry(first.id),
      (e) => e.status === 404,
    );
    assert.throws(
      () => store.remove(first.id),
      (e) => e.status === 404,
    );
  },
);
db.close();
console.log(`\nJALUR LOGIKA/STORE/KMZ: ${passed} pemeriksaan lulus.`);
