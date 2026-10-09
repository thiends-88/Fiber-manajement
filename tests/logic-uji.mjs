// Uji logika murni (tanpa React, tanpa server): topologi, alur core, dan data
// kabel. Dijalankan dengan: npm run test:logic
import { getCableInfo, coresPerTube, colorForCoreInCable, SPLITTER_RATIOS, splitterPorts } from "../src/lib/fiber.js";
import { buildTopologyGraph, buildUpstreamChains, EDGE_STYLE } from "../src/lib/topology.js";
import { buildCoreRoutes, daftarRuteOdp } from "../src/lib/jalur-core.js";

let lolos = 0;
let gagal = 0;

function cek(nama, kondisi, detail = "") {
  if (kondisi) {
    lolos++;
    console.log(`  OK    ${nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL ${nama}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Fixture: OLT → ODC-001[SPL 1:4 → cascade SPL 1:8] → ODC-003 (anak)
//          → SPL 1:8 → ODP-001 → SPL 1:8 di dalam ODP
// ---------------------------------------------------------------------------
const olts = [{ id: 1, name: "OLT-PST-01", olt_type: "Huawei MA5800" }];
const odcs = [
  { id: 1, olt_id: 1, name: "ODC-001", cable_type: "48_core_8_tube" },
  { id: 3, olt_id: 1, name: "ODC-003", cable_type: "24_core_4_tube" },
];
const odps = [
  { id: 1, odc_id: 1, name: "ODP-001", cable_type: "12_core_2_tube" }, // jalur langsung 4:8:8
  { id: 4, odc_id: 3, name: "ODP-004", cable_type: "12_core_2_tube" }, // lewat ODC anak
];
const splitters = [
  {
    id: 10,
    odc_id: 1,
    odp_id: null,
    name: "SPL-1",
    ratio: "1:4",
    outputs: [
      { port: 1, target_type: "splitter", target_splitter_id: 11 }, // cascade 1:8 di ODC yang sama
      { port: 2, target_type: "splitter", target_splitter_id: 13 }, // cascade ke splitter di ODC ANAK
      { port: 3, target_type: "odc", target_odc_id: 3 }, // umpan ke ODC anak
    ],
  },
  {
    id: 11,
    odc_id: 1,
    odp_id: null,
    name: "SPL-2",
    ratio: "1:8",
    outputs: [{ port: 1, target_type: "odp", target_odp_id: 1 }],
  },
  {
    id: 13,
    odc_id: 3,
    odp_id: null,
    name: "SPL-3",
    ratio: "1:8",
    outputs: [{ port: 1, target_type: "odp", target_odp_id: 4 }],
  },
  { id: 12, odc_id: null, odp_id: 1, name: "SPL-ODP1", ratio: "1:8", outputs: [] },
  { id: 14, odc_id: null, odp_id: 4, name: "SPL-ODP4", ratio: "1:8", outputs: [] },
];
const links = [];
const feederPorts = [
  { odc_id: 1, port_id: 5, card_label: "Card 1", slot: 1, port: 1 },
];

console.log("\n=== UJI LOGIKA: topologi (diagram alur) ===");

const graf = buildTopologyGraph({ olts, odcs, odps, splitters, links, feederPorts });
const simpulOlt = graf.nodes.filter((n) => n.kind === "olt").length;
const simpulOdc = graf.nodes.filter((n) => n.kind === "odc").length;
const simpulOdp = graf.nodes.filter((n) => n.kind === "odp").length;
const simpulSpl = graf.nodes.filter((n) => n.kind === "spl").length;
const sisiCascade = graf.edges.filter((e) => e.kind === "cascade").length;
const sisiOdcAnak = graf.edges.filter((e) => e.kind === "splitter-odc").length;
const sisiKeOdp = graf.edges.filter((e) => e.kind === "out").length;

cek("simpul: 1 OLT", simpulOlt === 1);
cek("simpul: 2 ODC", simpulOdc === 2);
cek("simpul: 2 ODP", simpulOdp === 2);
cek("simpul: 5 splitter", simpulSpl === 5, `${simpulSpl}`);
cek("sisi cascade splitter (1:4 → 1:8, dan ke ODC anak) ada", sisiCascade === 2, `${sisiCascade}`);
cek("sisi output splitter → ODC anak ada (ODC induk/anak tergambar)", sisiOdcAnak === 1);
cek("sisi output splitter → ODP ada (2 jalur)", sisiKeOdp === 2, `${sisiKeOdp}`);
cek("setiap sisi menunjuk simpul yang benar-benar ada", graf.edges.every((e) => graf.nodes.some((n) => n.id === e.from) && graf.nodes.some((n) => n.id === e.to)));

console.log("\n=== UJI LOGIKA: data kabel & splitter ===");

cek("tipe kabel dikenal punya label", getCableInfo("48_core_8_tube")?.label === "48 Core / 8 Tube", getCableInfo("48_core_8_tube")?.label);
cek("tipe kabel asing → null (tidak error)", getCableInfo("tidak_ada") === null);
cek("48 core / 8 tube → 6 core per tube", coresPerTube("48_core_8_tube") === 6, `${coresPerTube("48_core_8_tube")}`);
cek("48 core / 4 tube → 12 core per tube", coresPerTube("48_core_4_tube") === 12);
cek("core 1 dan 2 warnanya beda", colorForCoreInCable(1, 12) !== colorForCoreInCable(2, 12));
cek("core 13 = core 1 di tube 2 (warna berulang per tube)", colorForCoreInCable(13, 12).name === colorForCoreInCable(1, 12).name);
cek("pilihan rasio splitter: 1:2 s/d 1:32", SPLITTER_RATIOS.join(",") === "1:2,1:4,1:8,1:16,1:32", SPLITTER_RATIOS.join(","));
cek("splitterPorts membaca jumlah port", splitterPorts("1:8") === 8 && splitterPorts("asal") === 0);

// ---------------------------------------------------------------------------
// Peta jalur core per core ODC: 1 core → splitter → ODP / ODC anak (cascade)
// ---------------------------------------------------------------------------
console.log("\n=== UJI LOGIKA: peta jalur core per core ODC ===");

const odcsJalur = [
  { id: 1, olt_id: 1, name: "ODC-001", cable_type: "24_core_4_tube" },
  { id: 3, olt_id: 1, name: "ODC-003", cable_type: "12_core_2_tube" },
];
const odpsJalur = [
  { id: 1, odc_id: 1, name: "ODP-001", location: "Jl. Melati", cable_type: "12_core_2_tube" },
  { id: 4, odc_id: 3, name: "ODP-004", location: "Dusun Kenanga", cable_type: "12_core_2_tube" },
];
const splJalur = [
  {
    id: 21, odc_id: 1, odp_id: null, name: "SPL-A", ratio: "1:4", input_core: 1,
    outputs: [
      { port: 1, target_type: "splitter", target_splitter_id: 22 }, // cascade di ODC yang sama
      { port: 2, target_type: "odp", target_odp_id: 1 }, // output → ODP
      { port: 3, target_type: "odc", target_odc_id: 3 }, // output → ODC anak
      // port 4 sengaja tidak diarahkan → harus diringkas sebagai idle
    ],
  },
  {
    id: 22, odc_id: 1, odp_id: null, name: "SPL-B", ratio: "1:8", input_core: null,
    outputs: [{ port: 1, target_type: "odp", target_odp_id: 4 }],
  },
  {
    id: 23, odc_id: 3, odp_id: null, name: "SPL-C", ratio: "1:8", input_core: 1,
    outputs: [{ port: 1, target_type: "odp", target_odp_id: 4 }],
  },
];
const coresJalur = [
  { source: "olt_to_odc", odc_id: 1, core: 1, status: "used", power_dbm: "-19.5" },
  { source: "olt_to_odc", odc_id: 1, core: 2, status: "used", power_dbm: "-20.2" },
];
const linksJalur = [
  { id: 31, odc_id: 1, odc_core: 2, odp_id: 4, odp_core: 3, notes: null },
  { id: 32, odc_id: 3, odc_core: 1, odp_id: 4, odp_core: 1, notes: null },
];

const peta = buildCoreRoutes({
  odcs: odcsJalur, odps: odpsJalur, splitters: splJalur,
  links: linksJalur, cores: coresJalur, odcId: 1,
});
const pohon1 = peta.trees[0]?.root;
const splB = pohon1?.children.find((c) => c.kind === "splitter");
const odpNode = pohon1?.children.find((c) => c.kind === "odp");
const odcAnak = pohon1?.children.find((c) => c.kind === "odc");
const splC = odcAnak?.children[0];

cek("satu pohon per core yang masuk splitter (hanya core 1)", peta.trees.length === 1 && peta.trees[0].core === 1, `trees=${peta.trees.length}`);
cek("akar pohon = splitter dengan input core tsb (SPL-A 1:4)", pohon1?.name === "SPL-A" && pohon1?.ratio === "1:4", pohon1?.name);
cek("info core feeder ikut terbawa ke pohon (status & daya)", peta.trees[0]?.feeder?.status === "used" && peta.trees[0]?.feeder?.power_dbm === "-19.5");
cek("output cascade → splitter lain (SPL-B via out 1)", splB?.name === "SPL-B" && splB?.viaPort === 1, `${splB?.name} via ${splB?.viaPort}`);
cek("output → ODP (ODP-001 via out 2)", odpNode?.name === "ODP-001" && odpNode?.port === 2, `${odpNode?.name} port ${odpNode?.port}`);
cek("output → ODC anak (ODC-003 via out 3)", odcAnak?.name === "ODC-003" && odcAnak?.port === 3, `${odcAnak?.name} port ${odcAnak?.port}`);
cek("jalur berlanjut di ODC anak (SPL-C → ODP-004)", splC?.name === "SPL-C" && splC?.children[0]?.kind === "odp" && splC?.children[0]?.name === "ODP-004", `${splC?.name}`);
cek("port belum diarahkan diringkas, bukan hilang (SPL-A sisa 1)", pohon1?.idlePorts === 1, `${pohon1?.idlePorts}`);
cek("ringkasan idle menghitung seluruh port rasio (SPL-B 1:8 − 1 = 7)", splB?.idlePorts === 7, `${splB?.idlePorts}`);
cek("sambungan kabel langsung dipisah dari pohon (1 link di ODC-001)", peta.directLinks.length === 1, `${peta.directLinks.length}`);
cek("sambungan langsung diberi label 'kabel langsung'", peta.directLinks[0]?.label.includes("kabel langsung"), peta.directLinks[0]?.label);
cek("data sambungan langsung lengkap (ODC core 2 → ODP-004 core 3)", peta.directLinks[0]?.odpName === "ODP-004" && peta.directLinks[0]?.odpCore === 3 && peta.directLinks[0]?.odcCore === 2, JSON.stringify(peta.directLinks[0]));
const petaAnak = buildCoreRoutes({
  odcs: odcsJalur, odps: odpsJalur, splitters: splJalur,
  links: linksJalur, cores: coresJalur, odcId: 3,
});
cek("peta ODC anak berdiri sendiri (core 1 → SPL-C)", petaAnak.trees[0]?.root?.name === "SPL-C" && petaAnak.directLinks.length === 1, petaAnak.trees[0]?.root?.name);
const splLingkar = [
  { id: 51, odc_id: 9, odp_id: null, name: "SPL-X", ratio: "1:2", input_core: 1,
    outputs: [{ port: 1, target_type: "splitter", target_splitter_id: 52 }] },
  { id: 52, odc_id: 9, odp_id: null, name: "SPL-Y", ratio: "1:2", input_core: null,
    outputs: [{ port: 1, target_type: "splitter", target_splitter_id: 51 }] }, // balik ke akar
];
const petaLingkar = buildCoreRoutes({ odcs: [{ id: 9, name: "ODC-X" }], splitters: splLingkar, odcId: 9 });
cek("cascade berlingkar ditandai 'terputus' (tidak loop tak hingga)", petaLingkar.trees[0]?.root?.children[0]?.children[0]?.kind === "terputus", petaLingkar.trees[0]?.root?.children[0]?.children[0]?.kind);
cek("tanpa odcId / ODC tak dikenal → hasil kosong, tidak error", buildCoreRoutes({}).trees.length === 0 && buildCoreRoutes({ odcs: odcsJalur, odcId: 999 }).directLinks.length === 0);

// ---------------------------------------------------------------------------
// Warna core mengalir: core kabel ODC → splitter → cascade → ODP
// ---------------------------------------------------------------------------
console.log("\n=== UJI LOGIKA: warna core mengalir (topologi) ===");

const warnaOdc = [{ id: 1, olt_id: 1, name: "ODC-001", cable_type: "12_core_2_tube" }]; // 6 core/tube
const warnaOdp = [
  { id: 1, odc_id: 1, name: "ODP-001", cable_type: "12_core_2_tube" },
  { id: 2, odc_id: 1, name: "ODP-002", cable_type: "12_core_2_tube" },
];
const warnaSpl = [
  {
    id: 1, odc_id: 1, odp_id: null, name: "SPL-A", ratio: "1:2", input_core: 1,
    outputs: [
      { port: 1, target_type: "splitter", target_splitter_id: 2 }, // cascade
      { port: 2, target_type: "odp", target_odp_id: 1 },
    ],
  },
  {
    id: 2, odc_id: 1, odp_id: null, name: "SPL-B", ratio: "1:2", input_core: null,
    outputs: [{ port: 1, target_type: "odp", target_odp_id: 2 }],
  },
  { id: 3, odc_id: 1, odp_id: null, name: "SPL-C", ratio: "1:2", input_core: null, outputs: [] },
];
const warnaLinks = [{ id: 41, odc_id: 1, odc_core: 2, odp_id: 2, odp_core: 1, notes: null }];
const grafWarna = buildTopologyGraph({ olts, odcs: warnaOdc, odps: warnaOdp, splitters: warnaSpl, links: warnaLinks, feederPorts: [] });
const sisiKe = (id, kind) => grafWarna.edges.find((e) => e.to === id && e.kind === kind);
const odpWarna1 = grafWarna.nodes.find((n) => n.id === "odp-1");
const odpWarna2 = grafWarna.nodes.find((n) => n.id === "odp-2");

cek("garis feed core 1 = biru #2563eb", sisiKe("spl-1", "feed")?.color === "#2563eb", sisiKe("spl-1", "feed")?.color);
cek(
  "cascade mewarisi biru, dan SPL-B tidak digambar menerima core langsung dari ODC",
  grafWarna.edges.find((e) => e.kind === "cascade")?.color === "#2563eb" && sisiKe("spl-2", "feed") === undefined,
  sisiKe("spl-2", "feed") ? "masih ada garis feed ke SPL-B" : "garis feed ke SPL-B sudah tidak ada (benar)",
);
cek("output splitter → ODP ikut biru", sisiKe("odp-1", "out")?.color === "#2563eb" && sisiKe("odp-2", "out")?.color === "#2563eb");
cek("ODP.coreIn = core 1 / Biru / ODC-001", odpWarna1?.coreIn?.length === 1 && odpWarna1.coreIn[0].core === 1 && odpWarna1.coreIn[0].colorName === "Biru" && odpWarna1.coreIn[0].odcName === "ODC-001", JSON.stringify(odpWarna1?.coreIn));
cek("sambungan langsung core 2 = jingga #f97316", sisiKe("odp-2", "core")?.color === "#f97316" && odpWarna2?.coreIn?.some((c) => c.core === 2 && c.port === null), JSON.stringify(odpWarna2?.coreIn));
cek("tanpa input_core & tanpa induk → warna bawaan", sisiKe("spl-3", "feed")?.color === EDGE_STYLE.feed.color, sisiKe("spl-3", "feed")?.color);

// ---------------------------------------------------------------------------
// Alur core ke hulu: "core ini datang dari mana?" — dipakai halaman Alur Core
// ---------------------------------------------------------------------------
console.log("\n=== UJI LOGIKA: alur core ke hulu (buildUpstreamChains) ===");

const urutanJalur = (id) =>
  buildUpstreamChains(graf, id).map((c) => c.langkah.map((l) => l.node.title).join(" → "));

cek(
  "alur ODP-001 = OLT → ODC-001 → SPL-1 → SPL-2 → ODP-001",
  urutanJalur("odp-1")[0] === "OLT-PST-01 → ODC-001 → SPL-1 → SPL-2 → ODP-001",
  urutanJalur("odp-1")[0],
);
cek(
  "alur ODP-004 lewat cascade ke splitter di ODC anak",
  urutanJalur("odp-4")[0] === "OLT-PST-01 → ODC-001 → SPL-1 → SPL-3 → ODP-004",
  urutanJalur("odp-4")[0],
);
cek(
  "splitter di dalam ODP juga punya alur sampai ke OLT",
  urutanJalur("spl-12")[0]?.endsWith("→ ODP-001 → SPL-ODP1"),
  urutanJalur("spl-12")[0],
);
cek("tiap jalur ditandai lengkap (tidak terpotong)", buildUpstreamChains(graf, "odp-1")[0]?.lengkap === true);
cek(
  "tiap langkah membawa keterangan garisnya (port/core/output)",
  buildUpstreamChains(graf, "odp-1")[0]?.langkah?.[0]?.edge?.label === "p1" &&
    buildUpstreamChains(graf, "odp-1")[0]?.langkah?.[2]?.edge?.label === "out 1",
  JSON.stringify(buildUpstreamChains(graf, "odp-1")[0]?.langkah?.slice(1, 3).map((l) => l.edge?.label)),
);
cek("simpul sumber (OLT) → alur berisi dirinya sendiri", urutanJalur("olt-1")[0] === "OLT-PST-01");
cek("simpul tak dikenal → tanpa alur (tidak error)", buildUpstreamChains(graf, "odp-999").length === 0);
cek("tanpa argumen → tanpa alur", buildUpstreamChains(graf, null).length === 0 && buildUpstreamChains(null, "odp-1").length === 0);

// ---------------------------------------------------------------------------
// Core "power" ODP: core milik kabel ODP sendiri yang jadi output ODP itu
// ---------------------------------------------------------------------------
console.log("\n=== UJI LOGIKA: core power ODP ===");

// Fixture khusus: ODC dengan splitter ber-input core → dua ODP
const odcPower = [{ id: 1, olt_id: 1, name: "ODC-001", cable_type: "24_core_4_tube" }];
const odpPower = [
  { id: 1, odc_id: 1, name: "ODP-001", cable_type: "8_core" },
  { id: 2, odc_id: 1, name: "ODP-002", cable_type: "8_core" },
];
const splPower = [
  {
    id: 1, odc_id: 1, odp_id: null, name: "SPL-1", ratio: "1:4", input_core: 1,
    outputs: [
      { port: 1, target_type: "odp", target_odp_id: 1 },
      { port: 2, target_type: "odp", target_odp_id: 2 },
    ],
  },
];
const coreOdp = [
  { source: "odc_to_odp", odp_id: 1, core: 3, status: "used" },
  { source: "odc_to_odp", odp_id: 1, core: 1, status: "idle" },
  { source: "odc_to_odp", odp_id: 2, core: 2, status: "used" },
  { source: "olt_to_odc", odc_id: 1, core: 1, status: "used" }, // bukan power ODP
];
const petaPower = buildCoreRoutes({ odcs: odcPower, odps: odpPower, splitters: splPower, links: [], cores: coreOdp, odcId: 1 });
const cariOdp = (node, id) => {
  if (!node) return null;
  if (node.kind === "odp" && node.odpId === id) return node;
  for (const c of node.children ?? []) {
    const ketemu = cariOdp(c, id);
    if (ketemu) return ketemu;
  }
  return null;
};
const odp1 = cariOdp(petaPower.trees[0]?.root, 1);

cek("ODP di pohon jalur membawa core power-nya", Array.isArray(odp1?.powerCores) && odp1.powerCores.length === 2, JSON.stringify(odp1?.powerCores));
cek("core power urut dari kecil", odp1?.powerCores?.map((c) => c.core).join(",") === "1,3", odp1?.powerCores?.map((c) => c.core).join(","));
cek("status core power ikut terbawa", odp1?.powerCores?.[0]?.status === "idle" && odp1?.powerCores?.[1]?.status === "used");
cek("core ODC (olt_to_odc) tidak dianggap power ODP", !odp1?.powerCores?.some((c) => c.core === 1 && c.status === "used"));
cek("core power ODP lain tidak tertukar", cariOdp(petaPower.trees[0]?.root, 2)?.powerCores?.map((c) => c.core).join(",") === "2");

// ODP yang belum punya core sama sekali
const petaKosong = buildCoreRoutes({ odcs: odcPower, odps: odpPower, splitters: splPower, links: [], cores: [], odcId: 1 });
cek("ODP tanpa core power → array kosong, bukan undefined", cariOdp(petaKosong.trees[0]?.root, 1)?.powerCores?.length === 0);

// Beberapa splitter pada satu ODC boleh memakai input core yang sama
// (kunci render harus menyertakan id splitter, bukan hanya nomor core)
const splKembar = [
  { id: 2, odc_id: 1, odp_id: null, name: "SPL-A", ratio: "1:4", input_core: 1, outputs: [{ port: 1, target_type: "odp", target_odp_id: 1 }] },
  { id: 3, odc_id: 1, odp_id: null, name: "SPL-B", ratio: "1:8", input_core: 1, outputs: [{ port: 1, target_type: "odp", target_odp_id: 2 }] },
  { id: 4, odc_id: 1, odp_id: null, name: "SPL-C", ratio: "1:8", input_core: 2, outputs: [] },
];
const petaKembar = buildCoreRoutes({ odcs: odcPower, odps: odpPower, splitters: splKembar, links: [], cores: coreOdp, odcId: 1 });
cek("beberapa splitter ber-input core sama tetap jadi semua pohon", petaKembar.trees.length === 3, `dapat ${petaKembar.trees.length} pohon`);
cek("nomor core boleh berulang antar pohon", petaKembar.trees.filter((t) => t.core === 1).length === 2);
cek("kunci unik tiap pohon tersedia (id splitter + core)", new Set(petaKembar.trees.map((t) => `${t.root.id}-${t.core}`)).size === 3);

const grafPower = buildTopologyGraph({ olts, odcs, odps, splitters, links, feederPorts, cores: coreOdp });
const simpulOdp1 = grafPower.nodes.find((n) => n.id === "odp-1");
cek(
  "simpul ODP di diagram membawa warna core power",
  simpulOdp1?.powerCores?.length === 2 && simpulOdp1.powerCores.every((c) => /^#[0-9a-f]{6}$/i.test(c.hex)) && simpulOdp1.powerCores.every((c) => typeof c.colorName === "string"),
  JSON.stringify(simpulOdp1?.powerCores),
);
cek(
  "tanpa data core → powerCores kosong (tidak error)",
  buildTopologyGraph({ olts, odcs, odps, splitters, links, feederPorts }).nodes.find((n) => n.id === "odp-1")?.powerCores?.length === 0,
);

// ---------------------------------------------------------------------------
// daftarRuteOdp — rute pipih per tujuan (dipakai Laporan & deteksi core terpakai)
// ---------------------------------------------------------------------------
{
  // Skenario lapangan: core 1 → SPL 1:4 → cascade SPL 1:4 → ODP (SPL 1:8)
  const splBertingkat = [
    { id: 1, odc_id: 10, odp_id: null, name: "SPL-A", ratio: "1:4", input_core: 1,
      outputs: [{ port: 1, target_type: "splitter", target_splitter_id: 2 }] },
    { id: 2, odc_id: 10, odp_id: null, name: "SPL-B", ratio: "1:4", input_core: null,
      outputs: [{ port: 3, target_type: "odp", target_odp_id: 100 }] },
    { id: 3, odc_id: null, odp_id: 100, name: "SPL ODP-X", ratio: "1:8", input_core: 1, outputs: [] },
  ];
  const odpX = [{ id: 100, odc_id: 10, name: "ODP-X", cable_type: "12_core_2_tube" }];
  const petaX = buildCoreRoutes({ odcs: [{ id: 10 }], odps: odpX, splitters: splBertingkat, links: [], cores: [], odcId: 10 });
  const ruteX = daftarRuteOdp(petaX.trees);
  cek("daftarRuteOdp menemukan ODP di ujung cascade", ruteX.length === 1 && ruteX[0].odpId === 100, JSON.stringify(ruteX));
  cek(
    "jalur via berurutan lengkap dengan nomor output",
    ruteX[0]?.via.join(" → ") === "SPL-A (1:4) out 1 → SPL-B (1:4) out 3",
    ruteX[0]?.via.join(" → "),
  );
  cek("core sumber ikut terbawa di rute", ruteX[0]?.core === 1);

  // Rute lewat ODC anak ikut terdata, dan pohon kosong tidak membuat rute palsu
  const splKeAnak = [
    { id: 1, odc_id: 10, odp_id: null, name: "SPL-A", ratio: "1:4", input_core: 2,
      outputs: [{ port: 4, target_type: "odc", target_odc_id: 99 }] },
  ];
  const petaInduk = buildCoreRoutes({
    odcs: [{ id: 10 }, { id: 99, name: "ODC-ANAK" }],
    odps: [], splitters: splKeAnak, links: [], cores: [], odcId: 10,
  });
  const ruteInduk = daftarRuteOdp(petaInduk.trees);
  cek("rute ke ODC anak tercatat dengan nama", ruteInduk.some((r) => r.odcAnakId === 99 && r.odcAnakName === "ODC-ANAK"), JSON.stringify(ruteInduk));
  cek("daftarRuteOdp aman untuk masukan kosong", daftarRuteOdp([]).length === 0 && daftarRuteOdp().length === 0);
}

console.log(`\nLOGIKA: ${lolos} lolos, ${gagal} gagal`);
if (gagal) process.exit(1);
