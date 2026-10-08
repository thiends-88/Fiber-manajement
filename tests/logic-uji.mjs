// Uji logika murni (tanpa React, tanpa server): anggaran daya optik,
// topologi, dan data kabel. Dijalankan dengan: npm run test:logic
import {
  SPLITTER_LOSS,
  GPON,
  splitterLoss,
  budgetStatus,
  fmtDbm,
  fmtDb,
  buildPowerBudget,
} from "../src/lib/budget.js";
import { getCableInfo, coresPerTube, colorForCoreInCable, SPLITTER_RATIOS, splitterPorts } from "../src/lib/fiber.js";
import { buildTopologyGraph } from "../src/lib/topology.js";
import { buildCoreRoutes } from "../src/lib/jalur-core.js";

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
function dekat(a, b, toleransi = 0.05) {
  return a !== null && b !== null && Math.abs(a - b) <= toleransi;
}

// ---------------------------------------------------------------------------
// Fixture: OLT → ODC-001[SPL 1:4 → cascade SPL 1:8] → ODC-003 (anak)
//          → SPL 1:8 → ODP-001 → SPL 1:8 di dalam ODP
// ---------------------------------------------------------------------------
const olts = [{ id: 1, name: "OLT-PST-01", olt_type: "Huawei MA5800" }];
const odcs = [
  { id: 1, olt_id: 1, name: "ODC-001", cable_type: "48_core_8_tube", feeder_loss_db: 2.3 },
  { id: 3, olt_id: 1, name: "ODC-003", cable_type: "24_core_4_tube", feeder_loss_db: 1.5 },
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
  { odc_id: 1, port_id: 5, card_label: "Card 1", slot: 1, port: 1, tx_power: 7 },
];

console.log("\n=== UJI LOGIKA: anggaran daya optik ===");

cek("redaman splitter 1:4 = 7,3 dB", splitterLoss("1:4") === 7.3, `${splitterLoss("1:4")}`);
cek("redaman splitter 1:8 = 10,5 dB", splitterLoss("1:8") === 10.5, `${splitterLoss("1:8")}`);
cek("rasio tidak dikenal → null (tidak mengarang angka)", splitterLoss("1:9") === null);
cek("semua rasio yang ditawarkan punya nilai redaman", SPLITTER_RATIOS.every((r) => splitterLoss(r) !== null));

cek("status: di bawah sensitivitas → gagal", budgetStatus(GPON.sensitivity - 0.1).level === "fail");
cek("status: tepat di sensitivitas (−28) → rawan", budgetStatus(-28).level === "warn");
cek("status: di bawah sensitivitas (−28,1) → gagal", budgetStatus(-28.1).level === "fail");
cek("status: mendekati batas (3 dB di atas sensitivitas) → warn", budgetStatus(-25.5).level === "warn");
cek("status: di tengah rentang aman → aman", budgetStatus(-21.3).level === "ok");
cek("status: terlalu kuat (overload) → warn", budgetStatus(-6).level === "warn");
cek("status: data belum lengkap → unknown", budgetStatus(null).level === "unknown" && budgetStatus(undefined).level === "unknown");
cek("format dBm", fmtDbm(-21.3) === "-21.3 dBm" && fmtDbm(null) === "—");
cek("format dB", fmtDb(28.3) === "28.3 dB");

const budget = buildPowerBudget({ olts, odcs, odps, splitters, links, feederPorts });
const odp1 = budget.find((b) => b.odpName === "ODP-001");
const odp4 = budget.find((b) => b.odpName === "ODP-004");

cek("budget menghasilkan 1 baris per ODP", budget.length === 2);

// ODP-001: OLT → ODC-001[SPL 1:4 → cascade SPL 1:8] → ODP-001[SPL 1:8]
// splitter 7,3 + 10,5 + 10,5 = 28,3 dB, feeder 2,3 dB → total 30,6 dB
cek("jalur langsung 4:8:8 tidak melewati ODC lain", JSON.stringify(odp1?.odcPath) === '["ODC-001"]', JSON.stringify(odp1?.odcPath));
cek("OLT yang dipakai adalah OLT paling hulu", odp1?.oltName === "OLT-PST-01", odp1?.oltName);
cek("TX SFP terbaca +7 dBm", odp1?.tx === 7, `${odp1?.tx}`);
cek("redaman total 4:8:8 + feeder = 30,6 dB", dekat(odp1?.lossTotal, 30.6), `${odp1?.lossTotal}`);
cek("daya tiba 4:8:8 = 7 − 30,6 = −23,6 dBm", dekat(odp1?.finalOut, -23.6), `${odp1?.finalOut}`);
cek("status jalur 4:8:8 = aman", odp1?.status?.level === "ok", odp1?.status?.label);
cek("rantai splitter berurutan dari hulu", odp1?.chain.map((s) => s.ratio).join(",") === "1:4,1:8", odp1?.chain.map((s) => s.ratio).join(","));

// ODP-004: lewat ODC anak, dan splitter 1:4 di ODC induk MENCAH SABUNG ke
// splitter di ODC anak. Splitter induk yang sama tidak boleh dihitung dua kali:
// 7,3 (1:4, sekali) + 10,5 (1:8 di ODC anak) + 10,5 (1:8 dalam ODP) = 28,3 dB
// + feeder 2,3 + 1,5 = 32,1 dB → 7 − 32,1 = −25,1 dBm
cek("jalur anak melewati ODC induk lalu ODC anak", JSON.stringify(odp4?.odcPath) === '["ODC-001","ODC-003"]', JSON.stringify(odp4?.odcPath));
cek("splitter induk TIDAK dihitung dua kali", dekat(odp4?.lossTotal, 32.1), `${odp4?.lossTotal} (seharusnya 32,1)`);
cek("daya tiba lewat ODC anak = −25,1 dBm", dekat(odp4?.finalOut, -25.1), `${odp4?.finalOut}`);
cek("status jalur anak = mendekati batas (warn)", odp4?.status?.level === "warn", odp4?.status?.label);
cek("rantai splitter anak: 1:4 lalu 1:8", odp4?.chain.map((s) => s.ratio).join(",") === "1:4,1:8", odp4?.chain.map((s) => s.ratio).join(","));

const budgetKosong = buildPowerBudget({ olts, odcs, odps: [], splitters, links, feederPorts });
cek("tanpa ODP → tidak ada baris anggaran (tidak error)", Array.isArray(budgetKosong) && budgetKosong.length === 0);

const budgetTanpaTx = buildPowerBudget({ olts, odcs, odps, splitters, links, feederPorts: [] });
cek("tanpa data TX SFP → status unknown (bukan angka palsu)", budgetTanpaTx[0]?.status?.level === "unknown" && budgetTanpaTx[0]?.finalOut === null);

// rasio splitter tanpa nilai redaman → jalur ditandai "belum bisa dihitung",
// TIDAK dihitung 0 dB supaya tidak tampak lebih baik dari kenyataan
const splRasioAneh = {
  id: 99,
  odc_id: 1,
  odp_id: null,
  name: "SPL-Aneh",
  ratio: "1:3",
  outputs: [{ port: 1, target_type: "odp", target_odp_id: 1 }],
};
const odpAneh = buildPowerBudget({
  olts,
  odcs,
  odps: [odps[0]],
  splitters: [splRasioAneh, { id: 12, odc_id: null, odp_id: 1, name: "SPL-ODP1", ratio: "1:8", outputs: [] }],
  links,
  feederPorts,
}).find((b) => b.odpName === "ODP-001");
cek("rasio splitter tak dikenal → redaman tidak dikarang (null)", odpAneh?.lossTotal === null, `${odpAneh?.lossTotal}`);
cek("rasio splitter tak dikenal → status unknown", odpAneh?.status?.level === "unknown", odpAneh?.status?.label);
cek("rasio splitter tak dikenal → daya tiba null (bukan angka palsu)", odpAneh?.finalOut === null, `${odpAneh?.finalOut}`);
cek("format dB untuk null → tanda —", fmtDb(null) === "—" && fmtDb(undefined) === "—");

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
  { id: 31, odc_id: 1, odc_core: 2, odp_id: 4, odp_core: 3, loss_db: 0.3, notes: null },
  { id: 32, odc_id: 3, odc_core: 1, odp_id: 4, odp_core: 1, loss_db: null, notes: null },
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
cek("data sambungan langsung lengkap (ODP-004 core 3, 0,3 dB)", peta.directLinks[0]?.odpName === "ODP-004" && peta.directLinks[0]?.odpCore === 3 && peta.directLinks[0]?.lossDb === 0.3);
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

console.log(`\nLOGIKA: ${lolos} lolos, ${gagal} gagal`);
if (gagal) process.exit(1);
