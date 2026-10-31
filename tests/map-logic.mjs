import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { unzipSync, strFromU8 } from "fflate";
import {
  locationCoordinates,
  resolveCoordinates,
  coordinateUpdate,
  coordinateForm,
  coordinateText,
} from "../src/lib/coordinates.js";
import {
  buildNetworkMap,
  filterNetworkMap,
  SCHEMATIC_NOTICE,
} from "../src/lib/network-map.js";
import { buildKml, createKmz, xmlEscape } from "../src/lib/kmz.js";
import { mapFixture } from "./map-fixture.mjs";
let passed = 0,
  failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("OK   ", name);
  } catch (error) {
    failed++;
    console.error("GAGAL", name, "—", error.message);
  }
}
const valid = (value, lat, lng) => {
  assert.equal(value.status, "valid");
  assert.ok(Math.abs(value.latitude - lat) < 1e-10);
  assert.ok(Math.abs(value.longitude - lng) < 1e-10);
};
const badUpdate = (body) =>
  assert.throws(
    () => coordinateUpdate(body),
    (e) => e.status === 400,
  );
console.log("\n=== KOORDINAT / SUMBER KONEKSI / KMZ ===");
for (const location of [
  "-0.7912, 100.6488",
  " ( -0.7912, 100.6488 ) ",
  "-0.7912;100.6488",
  "-0,7912;100,6488",
  "-0.7912 100.6488",
])
  check(
    `Lokasi lama ${JSON.stringify(location)} dibaca tanpa ditulis ulang`,
    () => valid(locationCoordinates(location), -0.7912, 100.6488),
  );
check("DMS dengan hemisfer eksplisit dikonversi, bukan ditebak", () => {
  valid(locationCoordinates("0°47'24\"S, 100°38'24\"E"), -0.79, 100.64);
  assert.equal(
    locationCoordinates("0°60'0\"S, 100°38'24\"E").status,
    "invalid",
  );
});
check("parameter titik Google Maps diterima tanpa fetch/geocoding", () => {
  valid(
    locationCoordinates(
      "https://www.google.com/maps/search/?api=1&query=-0.79%2C100.64",
    ),
    -0.79,
    100.64,
  );
  valid(
    locationCoordinates("https://maps.google.com/?q=-0.79,100.64"),
    -0.79,
    100.64,
  );
});
for (const location of [
  "Jalan 12, Solok",
  "https://maps.app.goo.gl/abc",
  "https://www.google.com/maps/@-0.79,100.64,17z",
  "https://maps.google.com/?ll=-0.79,100.64",
  "https://evil.test/?q=-0.79,100.64",
  "https://google.com.evil.test/?q=-0.79,100.64",
  "-0,7912,100,6488",
  "",
  null,
])
  check(`alamat/viewport/format ambigu tidak diberi titik: ${location}`, () =>
    assert.notEqual(locationCoordinates(location).status, "valid"),
  );
check("latitude/longitude tidak ditukar demi lolos rentang", () => {
  assert.equal(locationCoordinates("100.64,-0.79").status, "invalid");
  assert.equal(locationCoordinates("-91, 100").status, "invalid");
  assert.equal(locationCoordinates("0,181").status, "invalid");
});
check("batas WGS84 dan pasangan 0,0 eksplisit sah, bukan fallback", () => {
  valid(locationCoordinates("90,-180"), 90, -180);
  valid(
    resolveCoordinates({
      coordinate_mode: "manual",
      latitude: 0,
      longitude: 0,
    }),
    0,
    0,
  );
  assert.equal(coordinateText(resolveCoordinates({})), "Belum ada koordinat");
});
check("mode none tidak memunculkan kembali GPS pada Lokasi lama", () =>
  assert.equal(
    resolveCoordinates({
      coordinate_mode: "none",
      location: "-0.79,100.64",
      latitude: -0.79,
      longitude: 100.64,
    }).status,
    "missing",
  ),
);
check("GPS manual rusak tidak jatuh kembali ke Lokasi yang valid", () =>
  assert.equal(
    resolveCoordinates({
      coordinate_mode: "manual",
      latitude: 100.64,
      longitude: -0.79,
      location: "-0.79,100.64",
    }).status,
    "invalid",
  ),
);
check("PATCH tanpa field GPS mempertahankan mode/pasangan lama", () => {
  const old = { coordinate_mode: "manual", latitude: 0, longitude: 100 };
  assert.deepEqual(coordinateUpdate({ notes: "baru" }, old), old);
  assert.deepEqual(coordinateForm(old), old);
});
check(
  "PATCH parsial pasangan manual mengambil komponen terkini, termasuk nol",
  () => {
    assert.deepEqual(
      coordinateUpdate(
        { latitude: "-0,79" },
        { coordinate_mode: "manual", latitude: 1, longitude: 0 },
      ),
      { coordinate_mode: "manual", latitude: -0.79, longitude: 0 },
    );
  },
);
check(
  "pasangan kosong eksplisit menjadi none; location membersihkan GPS manual",
  () => {
    assert.deepEqual(coordinateUpdate({ latitude: null, longitude: "" }), {
      coordinate_mode: "none",
      latitude: null,
      longitude: null,
    });
    assert.deepEqual(coordinateUpdate({ coordinate_mode: "location" }), {
      coordinate_mode: "location",
      latitude: null,
      longitude: null,
    });
  },
);
for (const body of [
  { latitude: 0 },
  { latitude: null, longitude: 100 },
  { latitude: "", longitude: 0 },
  { latitude: false, longitude: 0 },
  { latitude: [], longitude: 0 },
  { latitude: {}, longitude: 0 },
  { latitude: "Infinity", longitude: 0 },
  { latitude: Infinity, longitude: 0 },
  { latitude: NaN, longitude: 0 },
  { latitude: "0x20", longitude: 0 },
  { latitude: 91, longitude: 0 },
  { latitude: 0, longitude: -181 },
  { coordinate_mode: "unknown" },
  { coordinate_mode: "none", latitude: 0, longitude: 0 },
  { coordinate_mode: "manual" },
])
  check(`API menolak GPS tidak valid ${JSON.stringify(body)}`, () =>
    badUpdate(body),
  );
check(
  "kolom GPS terstruktur tanpa mode memakai manual secara konsisten pada resolver/form/PATCH",
  () => {
    const row = { latitude: 0, longitude: 100 };
    valid(resolveCoordinates(row), 0, 100);
    assert.equal(coordinateForm(row).coordinate_mode, "manual");
    assert.equal(
      coordinateUpdate({ notes: "tidak mengubah GPS" }, row).coordinate_mode,
      "manual",
    );
    assert.deepEqual(coordinateUpdate({ latitude: 1 }, row), {
      coordinate_mode: "manual",
      latitude: 1,
      longitude: 100,
    });
  },
);
const fixture = mapFixture(),
  model = buildNetworkMap(fixture),
  full = filterNetworkMap(model);
check(
  "semua ID tiga jenis dipertahankan; missing/invalid bukan titik 0,0",
  () => {
    assert.equal(model.nodes.length, 13);
    assert.equal(full.points.length, 9);
    assert.equal(full.missing.length, 4);
    assert.equal(new Set(model.nodes.map((n) => n.key)).size, 13);
    assert.equal(
      full.points.filter(
        (n) => n.coordinates.latitude === 0 && n.coordinates.longitude === 0,
      ).length,
      1,
    );
  },
);
check("tiga perangkat berkoordinat sama tidak dideduplikasi", () =>
  assert.deepEqual(
    full.points
      .filter(
        (n) =>
          n.coordinates.latitude === -0.79 &&
          n.coordinates.longitude === 100.64,
      )
      .map((n) => n.key)
      .sort(),
    ["odc-1", "odp-1", "olt-1"],
  ),
);
check(
  "OLT→ODC perlu mapping interface yang eksplisit, bukan feeder/induk/status aktif",
  () => {
    const feeder = model.connections.filter((e) => e.from.kind === "olt");
    assert.equal(feeder.length, 1);
    assert.equal(feeder[0].to.key, "odc-1");
    assert.match(feeder[0].evidence[0], /GPON 1\/2\/1/);
    assert.ok(
      !model.connections.some(
        (e) => e.from.key === "olt-1" && e.to.key === "odc-2",
      ),
    );
  },
);
check(
  "kabel langsung dan output ke ODP digabung per pasangan, bukti tidak hilang",
  () => {
    const edge = model.connections.find((e) => e.key === "odc-1--odp-1");
    assert.equal(edge.evidence.length, 2);
    assert.ok(edge.drawable);
  },
);
check(
  "ODC→ODC, receiver tepat, lintas induk, cascade dan ODP downstream tidak hilang",
  () => {
    const child = model.connections.find((e) => e.key === "odc-1--odc-2");
    assert.ok(child && !child.review);
    assert.match(child.evidence[0], /SPL-UJI-RECEIVER/);
    assert.ok(model.connections.find((e) => e.key === "odc-1--odc-3")?.review);
    assert.ok(model.connections.some((e) => e.key === "odp-1--odp-2"));
    assert.ok(!model.connections.some((e) => e.from.key === e.to.key));
  },
);
check(
  "tanpa mapping, titik dan hubungan kabinet tetap ada tanpa garis OLT palsu",
  () => {
    const unmapped = buildNetworkMap({ ...fixture, interfaceMappings: [] });
    assert.equal(filterNetworkMap(unmapped).points.length, 9);
    assert.ok(!unmapped.connections.some((e) => e.from.kind === "olt"));
    assert.ok(unmapped.connections.some((e) => e.key === "odc-1--odp-2"));
  },
);
check(
  "konflik input/OLT/feeder/core/port ganda membatalkan bukti sumber",
  () => {
    for (const data of [
      {
        ...fixture,
        links: [
          ...fixture.links,
          { id: 99, odc_id: 1, odc_core: 1, odp_id: 2, odp_core: 3 },
        ],
      },
      { ...fixture, feederPorts: [] },
      {
        ...fixture,
        interfaceMappings: [{ id: 1, odc_id: 1, core: 1, port_id: 21 }],
      },
      {
        ...fixture,
        interfaceMappings: [{ id: 1, odc_id: 1, core: 99, port_id: 11 }],
      },
      {
        ...fixture,
        interfaceMappings: [
          ...fixture.interfaceMappings,
          { id: 2, odc_id: 2, core: 2, port_id: 11 },
        ],
      },
      {
        ...fixture,
        feederPorts: [...fixture.feederPorts, { odc_id: 1, port_id: 12 }],
        interfaceMappings: [
          ...fixture.interfaceMappings,
          { id: 2, odc_id: 1, core: 1, port_id: 12 },
        ],
      },
    ]) {
      const invalid = buildNetworkMap(data);
      assert.ok(!invalid.connections.some((e) => e.from.kind === "olt"));
      assert.ok(invalid.issues.length);
    }
  },
);
check(
  "tujuan ganda, receiver salah, cascade lintas kabinet dan kabel legacy invalid ditandai",
  () => {
    const altered = structuredClone(fixture);
    altered.splitters[0].outputs[0].target_odc_id = 2;
    altered.splitters[0].outputs[1].target_odc_splitter_id = 101;
    altered.splitters[0].outputs[2].target_splitter_id = 201;
    altered.links.push({
      id: 88,
      odc_id: 1,
      odc_core: 99,
      odp_id: 3,
      odp_core: 1,
    });
    const result = buildNetworkMap(altered);
    assert.ok(result.connections.find((e) => e.key === "odc-1--odc-2")?.review);
    assert.ok(result.issues.some((i) => i.includes("tujuan konflik")));
    assert.ok(result.issues.some((i) => i.includes("melintasi induk")));
    assert.ok(result.issues.some((i) => i.includes("Kabel langsung #88")));
  },
);
check(
  "nama splitter sama tidak menggabungkan bukti output dengan ID yang berbeda",
  () => {
    const altered = structuredClone(fixture);
    altered.splitters.push({
      id: 103,
      odc_id: 1,
      name: "SPL-UJI-ROOT",
      input_core: 4,
      outputs: [{ id: 1030, port: 1, target_type: "odp", target_odp_id: 1 }],
    });
    const edge = buildNetworkMap(altered).connections.find(
      (e) => e.key === "odc-1--odp-1",
    );
    assert.equal(edge.evidence.length, 3);
    assert.ok(edge.evidence.some((e) => e.includes("output #1030")));
    assert.ok(edge.evidence.some((e) => e.includes("output #1001")));
  },
);
check(
  "receiver ID yang dipakai beberapa sumber ditandai konflik, bukan disamakan lewat core/warna",
  () => {
    const altered = structuredClone(fixture);
    altered.splitters.push({
      id: 401,
      odc_id: 3,
      name: "SPL sumber lain",
      input_core: 4,
      outputs: [
        {
          id: 4001,
          port: 1,
          target_type: "odc",
          target_odc_id: 2,
          target_odc_splitter_id: 201,
        },
      ],
    });
    const result = buildNetworkMap(altered);
    for (const key of ["odc-1--odc-2", "odc-3--odc-2"]) {
      const edge = result.connections.find((e) => e.key === key);
      assert.ok(edge.review);
      assert.match(edge.reviewReasons.join(";"), /receiver #201 konflik/);
    }
    assert.ok(result.issues.some((i) => i.includes("Receiver splitter #201")));
  },
);
check("koneksi tanpa GPS tidak diberi ujung fallback", () => {
  const altered = structuredClone(fixture);
  altered.odcs[1].coordinate_mode = "none";
  const view = filterNetworkMap(buildNetworkMap(altered));
  assert.ok(view.unpositionedConnections >= 2);
  assert.ok(
    !view.lines.some((e) => e.from.key === "odc-2" || e.to.key === "odc-2"),
  );
});
check("filter OLT adalah induk inventaris, bukan penelusuran sumber", () => {
  const view = filterNetworkMap(model, { oltId: 2 });
  assert.deepEqual(view.nodes.map((n) => n.key).sort(), [
    "odc-3",
    "odp-4",
    "odp-5",
    "olt-2",
  ]);
  assert.ok(view.hiddenConnections > 0);
});
check(
  "filter jenis/ODC/pencarian konsisten; garis hanya jika kedua ujung terlihat",
  () => {
    const odp = filterNetworkMap(model, { kind: "odp", odcId: 1 });
    assert.equal(odp.points.length, 2);
    assert.equal(odp.lines.length, 1);
    assert.ok(
      odp.lines.every((e) => e.from.kind === "odp" && e.to.kind === "odp"),
    );
    assert.equal(
      filterNetworkMap(model, { query: "odc-uji-a" }).nodes.length,
      3,
    );
    assert.equal(
      filterNetworkMap(model, { query: "tidak-ada-xyz" }).points.length,
      0,
    );
  },
);
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
const options = { scope: "lengkap", exportedAt: "2026-10-31T00:00:00.000Z" };
let archive, xml;
check("KMZ adalah ZIP sungguhan, doc.kml dan ketiga PNG lokal utuh", () => {
  const bytes = createKmz(full, options, icons);
  assert.deepEqual([...bytes.subarray(0, 4)], [80, 75, 3, 4]);
  archive = unzipSync(bytes);
  assert.deepEqual(Object.keys(archive).sort(), [
    "doc.kml",
    "icons/odc.png",
    "icons/odp.png",
    "icons/olt.png",
  ]);
  for (const kind of Object.keys(icons))
    assert.deepEqual(archive[`icons/${kind}.png`], icons[kind]);
  xml = new JSDOM(strFromU8(archive["doc.kml"]), { contentType: "text/xml" });
});
check(
  "KML valid namespace, folder terpisah, sembilan Point dan semua koneksi sah",
  () => {
    const doc = xml.window.document;
    assert.equal(
      doc.documentElement.namespaceURI,
      "http://www.opengis.net/kml/2.2",
    );
    assert.equal(doc.querySelectorAll("parsererror").length, 0);
    assert.equal(doc.querySelectorAll("Point").length, 9);
    assert.equal(doc.querySelectorAll("LineString").length, full.lines.length);
    for (const name of ["OLT", "ODC", "ODP", "Belum ada koordinat (4)"])
      assert.ok(
        [...doc.querySelectorAll("Folder > name")].some(
          (n) => n.textContent === name,
        ),
      );
  },
);
check(
  "KML memakai longitude,latitude,0; koordinat kolokasi dan nol eksplisit terjaga",
  () => {
    const doc = xml.window.document;
    assert.equal(
      doc.querySelector('[id="point-olt-1"] Point coordinates').textContent,
      "100.64,-0.79,0",
    );
    assert.equal(
      doc.querySelector('[id="point-olt-3"] Point coordinates').textContent,
      "0,0,0",
    );
    assert.equal(
      [...doc.querySelectorAll("Point coordinates")].filter(
        (n) => n.textContent === "100.64,-0.79,0",
      ).length,
      3,
    );
    assert.ok(!doc.querySelector('[id="point-odp-5"]'));
  },
);
check(
  "escape XML/HTML bertingkat menahan markup, CDATA-close, kontrol dan surrogate",
  () => {
    const doc = xml.window.document,
      raw = strFromU8(archive["doc.kml"]);
    assert.equal(
      doc.querySelector('[id="point-odp-2"] > name').textContent,
      fixture.odps[1].name,
    );
    assert.equal(doc.querySelectorAll("script, img").length, 0);
    const html = new JSDOM(
      doc.querySelector('[id="point-odp-2"] > description').textContent,
    );
    assert.equal(
      html.window.document.querySelectorAll("script, img").length,
      0,
    );
    assert.ok(
      html.window.document.body.textContent.includes(fixture.odps[1].name),
    );
    assert.ok(!raw.includes("\u0000"));
    assert.equal(xmlEscape("\ud800\u0000<&"), "�&lt;&amp;");
    html.window.close();
  },
);
check(
  "KML tidak memuat akun, hash, IP manajemen, app/session URL atau aset remote",
  () => {
    const raw = strFromU8(archive["doc.kml"]);
    for (const secret of [
      "192.0.2.55",
      "DO_NOT_EXPORT_HASH",
      "fiberops_token",
      "/api/",
      "NetworkLink",
    ])
      assert.ok(!raw.includes(secret));
    assert.deepEqual(
      [...xml.window.document.querySelectorAll("Icon href")]
        .map((n) => n.textContent)
        .sort(),
      ["icons/odc.png", "icons/odp.png", "icons/olt.png"],
    );
    assert.ok(
      xml.window.document.documentElement.textContent.includes(
        SCHEMATIC_NOTICE,
      ),
    );
  },
);
check(
  "ekspor lengkap tetap semua titik setelah filter, terfilter mengikuti pilihan",
  () => {
    const filtered = filterNetworkMap(model, { kind: "odp", odcId: 1 });
    const doc = new JSDOM(
      buildKml(filtered, { ...options, scope: "terfilter" }),
      { contentType: "text/xml" },
    );
    assert.equal(doc.window.document.querySelectorAll("Point").length, 2);
    assert.equal(doc.window.document.querySelectorAll("LineString").length, 1);
    assert.equal(
      new JSDOM(buildKml(full, options), {
        contentType: "text/xml",
      }).window.document.querySelectorAll("Point").length,
      9,
    );
    doc.window.close();
  },
);
check(
  "garis dapat dikeluarkan dari KMZ; daftar tanpa GPS tidak menghasilkan Point",
  () => {
    const doc = new JSDOM(
      buildKml(full, { ...options, includeConnections: false }),
      { contentType: "text/xml" },
    );
    assert.equal(doc.window.document.querySelectorAll("LineString").length, 0);
    assert.equal(doc.window.document.querySelectorAll("Point").length, 9);
    doc.window.close();
    const empty = new JSDOM(
      buildKml(filterNetworkMap(buildNetworkMap({})), options),
      { contentType: "text/xml" },
    );
    assert.equal(
      empty.window.document.querySelectorAll("Point, LineString").length,
      0,
    );
    empty.window.close();
  },
);
check(
  "ikon hilang/HTML fallback tidak menghasilkan KMZ setengah lengkap",
  () => {
    assert.throws(() => createKmz(full, options, {}), /belum tersedia/);
    assert.throws(
      () =>
        createKmz(full, options, {
          ...icons,
          olt: new Uint8Array([60, 104, 116, 109, 108]),
        }),
      /belum tersedia/,
    );
  },
);
xml?.window.close();
console.log(`\nPETA LOGIKA/KMZ: ${passed} lulus, ${failed} gagal.`);
if (failed) process.exitCode = 1;
