import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Download, ExternalLink, Eye, FileText, Network, Table2, X } from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { api } from "../lib/api.js";
import { Badge, Card, Empty, Field, PageHeader, SearchBox, Toast, matchesQuery, useToast } from "../components/ui.jsx";
import { STATUS, colorForCoreInCable, coresPerTube, getCableInfo, tubeForCoreInCable } from "../lib/fiber.js";
import { buildCoreRoutes, daftarRuteOdp } from "../lib/jalur-core.js";
import { CoreChip } from "../components/JalurCore.jsx";

const TABS = [
  { id: "odc", label: "Alur Core ODC", icon: Boxes },
  { id: "odp", label: "Power ODP", icon: Network },
  { id: "rekap", label: "Rekap Core", icon: Table2 },
];

const warnaCore = (core, cableType) => colorForCoreInCable(core, coresPerTube(cableType)).name;
const tubeCore = (core, cableType) => tubeForCoreInCable(core, coresPerTube(cableType));

function unduhCsv(nama, head, rows) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const lines = [head.join(";"), ...rows.map((r) => r.map(cell).join(";"))];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  a.href = objectUrl;
  a.download = `${nama}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/**
 * Pratinjau PDF dalam aplikasi, dirender ke <canvas> memakai pdf.js.
 * Dipakai karena PDF viewer bawaan Chrome diblokir di dalam iframe sandbox
 * (live preview), sedangkan render canvas murni JavaScript selalu jalan.
 */
function PratinjauPdf({ bytes }) {
  const hostRef = useRef(null);
  const [err, setErr] = useState("");
  const [memuat, setMemuat] = useState(true);

  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        setMemuat(true);
        setErr("");
        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
        if (batal) return;
        const host = hostRef.current;
        if (!host) return;
        host.innerHTML = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          if (batal) return;
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.className = "mb-3 rounded-lg border border-line bg-white shadow";
          host.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        }
        if (!batal) setMemuat(false);
      } catch (e) {
        if (!batal) {
          setErr(e.message);
          setMemuat(false);
        }
      }
    })();
    return () => {
      batal = true;
    };
  }, [bytes]);

  return (
    <div className="flex-1 overflow-y-auto rounded-lg bg-panel2 p-3">
      {memuat && <div className="p-6 text-center text-sm text-mut">Menyiapkan pratinjau…</div>}
      {err && <div className="p-6 text-center text-sm text-red-300">Pratinjau gagal: {err}. Gunakan tombol Unduh.</div>}
      <div ref={hostRef} className="mx-auto max-w-4xl" />
    </div>
  );
}

export default function Laporan() {
  const [tab, setTab] = useState("odc");
  const [error, setError] = useState("");

  // Data mentah untuk laporan alur
  const [odcs, setOdcs] = useState([]);
  const [odps, setOdps] = useState([]);
  const [splitters, setSplitters] = useState([]);
  const [links, setLinks] = useState([]);
  const [cores, setCores] = useState([]);
  const [feederPorts, setFeederPorts] = useState([]);
  const [rekap, setRekap] = useState(null);

  const [filterOdc, setFilterOdc] = useState("all");
  const [q, setQ] = useState("");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [pdfView, setPdfView] = useState(null); // { url, nama } — pratinjau PDF dalam aplikasi
  const [toastState, setToastState] = useState(null);
  const toast = useToast(setToastState);

  useEffect(() => {
    Promise.all([
      api("/api/odcs"), api("/api/odps"), api("/api/splitters"),
      api("/api/links"), api("/api/cores"), api("/api/feeder-ports"), api("/api/laporan"),
    ])
      .then(([d, p, s, l, c, f, r]) => {
        setOdcs(d); setOdps(p); setSplitters(s); setLinks(l); setCores(c); setFeederPorts(f); setRekap(r);
      })
      .catch((e) => {
        setError(e.message);
        setRekap([]);
      });
  }, []);

  // ---------- Laporan 1: alur core per ODC (sumber → splitter → tujuan) ----------
  const barisAlur = useMemo(() => {
    const hasil = [];
    for (const d of odcs) {
      if (filterOdc !== "all" && d.id !== Number(filterOdc)) continue;
      const myLinks = links.filter((l) => l.odc_id === d.id);
      const peta = buildCoreRoutes({ odcs, odps, splitters, links: myLinks, cores, odcId: d.id });
      const rute = daftarRuteOdp(peta.trees);
      const feeder = feederPorts
        .filter((f) => f.odc_id === d.id)
        .map((f) => `${f.card_label || `Card ${f.slot}`} p${f.port}`)
        .join(" · ");
      const sumber = `${d.olt_name}${feeder ? ` (${feeder})` : ""}`;

      for (const t of peta.trees) {
        const rs = rute.filter((r) => r.core === t.core);
        if (rs.length === 0) {
          hasil.push({
            key: `${d.id}-c${t.core}-idle`, odc: d, sumber, core: t.core,
            jalur: `${t.root.name} (${t.root.ratio})`, tujuan: "— output belum diarahkan",
          });
        }
        for (const r of rs) {
          hasil.push({
            key: `${d.id}-c${t.core}-${r.odpId ?? `odc${r.odcAnakId}`}-${r.via.join("|")}`,
            odc: d, sumber, core: t.core, jalur: r.via.join(" → "),
            tujuan: r.odpName ?? `ODC anak: ${r.odcAnakName}`,
          });
        }
      }
      for (const l of myLinks) {
        hasil.push({
          key: `${d.id}-link-${l.id}`, odc: d, sumber, core: l.odc_core,
          jalur: "kabel langsung (tanpa splitter)",
          tujuan: `${l.odp_name} core ${l.odp_core} (${warnaCore(l.odp_core, odps.find((p) => p.id === l.odp_id)?.cable_type)})`,
        });
      }
    }
    return hasil
      .filter((b) => matchesQuery(q, b.odc.name, b.sumber, `core ${b.core}`, warnaCore(b.core, b.odc.cable_type), b.jalur, b.tujuan))
      .sort((a, b) => a.odc.name.localeCompare(b.odc.name, "id", { numeric: true }) || a.core - b.core);
  }, [odcs, odps, splitters, links, cores, feederPorts, filterOdc, q]);

  // ---------- Laporan 2: power ODP (core warna apa, datang dari mana) ----------
  const barisOdp = useMemo(() => {
    // Rute via splitter dihitung per ODC sekali, lalu dikelompokkan per ODP
    const ruteSemua = [];
    for (const d of odcs) {
      const myLinks = links.filter((l) => l.odc_id === d.id);
      const peta = buildCoreRoutes({ odcs, odps, splitters, links: myLinks, cores, odcId: d.id });
      for (const r of daftarRuteOdp(peta.trees)) ruteSemua.push({ ...r, odc: d });
    }
    return odps
      .filter((p) => filterOdc === "all" || p.odc_id === Number(filterOdc))
      .map((p) => {
        const viaSplitter = ruteSemua.filter((r) => r.odpId === p.id);
        const viaLangsung = links.filter((l) => l.odp_id === p.id);
        const powerCores = cores
          .filter((c) => c.source === "odc_to_odp" && c.odp_id === p.id)
          .sort((a, b) => a.core - b.core);
        const splDalam = splitters.filter((s) => s.odp_id === p.id);
        return { odp: p, viaSplitter, viaLangsung, powerCores, splDalam };
      })
      .filter((b) =>
        matchesQuery(
          q,
          b.odp.name, b.odp.odc_name, b.odp.location,
          ...b.viaSplitter.map((r) => `core ${r.core} ${r.via.join(" ")}`),
          ...b.viaLangsung.map((l) => `core ${l.odc_core}`),
          ...b.powerCores.map((c) => `core ${c.core} ${warnaCore(c.core, b.odp.cable_type)} ${c.destination ?? ""}`),
          ...b.splDalam.map((s) => `${s.name} ${s.ratio}`),
        ),
      )
      .sort((a, b) => a.odp.name.localeCompare(b.odp.name, "id", { numeric: true }));
  }, [odcs, odps, splitters, links, cores, filterOdc, q]);

  // ---------- Laporan 3: rekap core (tabel lama) ----------
  const rekapFiltered = useMemo(() => {
    if (!rekap) return [];
    return rekap.filter(
      (r) => (source === "all" || r.source === source) && (status === "all" || r.status === status),
    );
  }, [rekap, source, status]);

  // Data ekspor (dipakai bersama CSV dan PDF) — mengikuti tab + filter + pencarian aktif
  function dataEkspor() {
    if (tab === "odc") {
      return {
        judul: "Laporan Alur Core ODC",
        slug: "laporan-alur-core-odc",
        head: ["ODC", "Sumber (OLT · feeder)", "Core", "Warna", "Tube", "Jalur Splitter", "Tujuan"],
        rows: barisAlur.map((b) => [
          b.odc.name, b.sumber, b.core,
          warnaCore(b.core, b.odc.cable_type), `Tube ${tubeCore(b.core, b.odc.cable_type)}`,
          b.jalur, b.tujuan,
        ]),
      };
    }
    if (tab === "odp") {
      const rows = [];
      for (const b of barisOdp) {
        const cableOdc = odcs.find((d) => d.id === b.odp.odc_id)?.cable_type;
        const jalurMasuk = [
          ...b.viaSplitter.map((r) => `core ${r.core} (${warnaCore(r.core, r.odc.cable_type)}) via ${r.via.join(" → ")}`),
          ...b.viaLangsung.map((l) => `core ${l.odc_core} (${warnaCore(l.odc_core, cableOdc)}) kabel langsung → core ODP ${l.odp_core}`),
        ].join(" | ") || "belum tersambung";
        const splOdp = b.splDalam.map((s) => `${s.name} (${s.ratio})`).join(", ");
        if (b.powerCores.length === 0) {
          rows.push([b.odp.name, b.odp.odc_name, jalurMasuk, splOdp, "", "", "", ""]);
        }
        for (const c of b.powerCores) {
          rows.push([
            b.odp.name, b.odp.odc_name, jalurMasuk, splOdp,
            c.core, warnaCore(c.core, b.odp.cable_type), STATUS[c.status]?.label ?? c.status, c.destination ?? "",
          ]);
        }
      }
      return {
        judul: "Laporan Power ODP",
        slug: "laporan-power-odp",
        head: ["ODP", "Induk ODC", "Jalur Masuk (dari ODC)", "Splitter di ODP", "Core Power", "Warna", "Status", "Tujuan"],
        rows,
      };
    }
    return {
      judul: "Laporan Rekap Core",
      slug: "laporan-core",
      head: ["Sumber", "Link", "Uplink", "Kabel", "Core", "Warna", "Status", "Tujuan", "Catatan"],
      rows: rekapFiltered.map((r) => [
        r.source === "olt_to_odc" ? "OLT → ODC" : "ODC → ODP",
        r.link_name ?? "", r.uplink_name ?? "",
        getCableInfo(r.cable_type)?.label ?? r.cable_type ?? "",
        r.core, warnaCore(r.core, r.cable_type),
        STATUS[r.status]?.label ?? r.status, r.destination ?? "", r.notes ?? "",
      ]),
    };
  }

  function exportCsv() {
    try {
      const d = dataEkspor();
      unduhCsv(d.slug, d.head, d.rows);
      toast("CSV dibuat — cek folder unduhan. Bila tidak muncul, buka preview di tab browser terpisah.");
    } catch (e) {
      toast(`Gagal membuat CSV: ${e.message}`, "error");
    }
  }

  // PDF: judul + tanggal + keterangan filter, lalu tabel data yang sama dengan CSV
  function bikinPdf() {
    const d = dataEkspor();
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const tanggal = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    const odcAktif = filterOdc === "all" ? "Semua ODC" : odcs.find((x) => x.id === Number(filterOdc))?.name ?? "";

    doc.setFontSize(14);
    doc.text(d.judul, 14, 14);
    doc.setFontSize(9);
    doc.setTextColor(110);
    const keterangan = [
      `Dicetak: ${tanggal}`,
      tab !== "rekap" ? `Filter: ${odcAktif}` : null,
      q.trim() ? `Pencarian: "${q.trim()}"` : null,
      `${d.rows.length} baris`,
    ].filter(Boolean).join("  ·  ");
    doc.text(keterangan, 14, 20);
    doc.setTextColor(0);

    autoTable(doc, {
      head: [d.head],
      body: d.rows,
      startY: 25,
      styles: { fontSize: 7.5, cellPadding: 1.6, overflow: "linebreak" },
      headStyles: { fillColor: [16, 98, 134], textColor: 255 },
      alternateRowStyles: { fillColor: [244, 248, 250] },
      margin: { left: 14, right: 14 },
      didDrawPage: () => {
        doc.setFontSize(8);
        doc.setTextColor(140);
        doc.text(
          `FiberOps — ${d.judul} · hal. ${doc.internal.getNumberOfPages()}`,
          14,
          doc.internal.pageSize.getHeight() - 6,
        );
        doc.setTextColor(0);
      },
    });
    return { doc, slug: d.slug };
  }

  function bukaPratinjau(unduhDulu) {
    try {
      const { doc, slug } = bikinPdf();
      const nama = `${slug}-${new Date().toISOString().slice(0, 10)}.pdf`;
      if (unduhDulu) doc.save(nama);
      setPdfView({
        url: URL.createObjectURL(doc.output("blob")),
        bytes: doc.output("arraybuffer"),
        nama,
      });
      if (unduhDulu) toast("PDF dibuat — bila unduhan tidak mulai otomatis, simpan lewat tombol Unduh di pratinjau.");
    } catch (e) {
      toast(`Gagal membuat PDF: ${e.message}`, "error");
    }
  }

  const unduhPdf = () => bukaPratinjau(true);
  const lihatPdf = () => bukaPratinjau(false);

  function tutupPdf() {
    if (pdfView?.url) setTimeout(() => URL.revokeObjectURL(pdfView.url), 1000);
    setPdfView(null);
  }

  const adaEkspor = tab === "odc" ? barisAlur.length > 0 : tab === "odp" ? barisOdp.length > 0 : rekapFiltered.length > 0;

  return (
    <div>
      <PageHeader title="Laporan" desc="Alur core per ODC, power ODP, dan rekap penugasan core.">
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={lihatPdf} disabled={!adaEkspor} title="Buka PDF di tab baru">
            <Eye size={15} /> Lihat PDF
          </button>
          <button className="btn btn-primary" onClick={unduhPdf} disabled={!adaEkspor}>
            <FileText size={15} /> Unduh PDF
          </button>
          <button className="btn" onClick={exportCsv} disabled={!adaEkspor}>
            <Download size={15} /> CSV
          </button>
        </div>
      </PageHeader>

      {/* Tab */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              className={`btn ${tab === t.id ? "btn-primary" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Filter */}
      <Card className="mb-4 flex flex-wrap items-center gap-3">
        {(tab === "odc" || tab === "odp") && (
          <>
            <Field label="ODC">
              <select className="input w-56" value={filterOdc} onChange={(e) => setFilterOdc(e.target.value)}>
                <option value="all">Semua ODC</option>
                {odcs.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.olt_name}</option>)}
              </select>
            </Field>
            <Field label="Pencarian">
              <SearchBox
                value={q}
                onChange={setQ}
                placeholder={tab === "odc" ? "Cari ODC, core, warna, splitter, tujuan…" : "Cari ODP, core, warna, splitter…"}
                className="w-full sm:w-72"
              />
            </Field>
          </>
        )}
        {tab === "rekap" && (
          <>
            <Field label="Segmen">
              <select className="input w-48" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="all">Semua</option>
                <option value="olt_to_odc">OLT → ODC</option>
                <option value="odc_to_odp">ODC → ODP</option>
              </select>
            </Field>
            <Field label="Status">
              <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">Semua</option>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </>
        )}
        <div className="ml-auto text-sm text-mut">
          {tab === "odc" ? `${barisAlur.length} jalur` : tab === "odp" ? `${barisOdp.length} ODP` : `${rekapFiltered.length} baris`}
        </div>
      </Card>

      {error && (
        <Card className="mb-4">
          <div className="text-sm text-red-300" role="alert">Data laporan tidak dapat dimuat: {error}</div>
        </Card>
      )}

      {/* ---------- Tab 1: Alur Core ODC ---------- */}
      {tab === "odc" && (
        <Card className="overflow-x-auto p-0">
          {barisAlur.length === 0 ? (
            <div className="p-6"><Empty text="Belum ada jalur core terdata. Isi input core splitter / sambungan kabel langsung di menu Mapping." /></div>
          ) : (
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">ODC</th>
                  <th className="th">Sumber (OLT · feeder)</th>
                  <th className="th">Core</th>
                  <th className="th">Jalur Splitter</th>
                  <th className="th">Tujuan</th>
                </tr>
              </thead>
              <tbody>
                {barisAlur.map((b) => (
                  <tr key={b.key} className="border-b border-line-soft last:border-0">
                    <td className="td font-medium">{b.odc.name}</td>
                    <td className="td text-mut">{b.sumber}</td>
                    <td className="td"><CoreChip core={b.core} cableType={b.odc.cable_type} small /></td>
                    <td className="td text-mut">{b.jalur}</td>
                    <td className="td">{b.tujuan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* ---------- Tab 2: Power ODP ---------- */}
      {tab === "odp" && (
        <div className="space-y-3">
          {barisOdp.length === 0 && <Card><Empty text="Belum ada ODP." /></Card>}
          {barisOdp.map((b) => {
            const cableOdc = odcs.find((d) => d.id === b.odp.odc_id)?.cable_type;
            return (
              <Card key={b.odp.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{b.odp.name}</span>
                  <Badge cls="bg-slate-500/15 text-slate-300">Induk: {b.odp.odc_name}</Badge>
                  <Badge cls="bg-amber-500/15 text-amber-300">{getCableInfo(b.odp.cable_type)?.label ?? b.odp.cable_type}</Badge>
                  {b.splDalam.map((s) => (
                    <Badge key={s.id} cls="bg-violet-500/15 text-violet-300">{s.name} ({s.ratio})</Badge>
                  ))}
                  <span className="text-xs text-mut">{b.odp.location || ""}</span>
                </div>

                {/* Dari mana corenya datang */}
                <div className="mt-3 text-xs">
                  <div className="mb-1 font-medium text-mut">Jalur masuk (dari ODC):</div>
                  {b.viaSplitter.length === 0 && b.viaLangsung.length === 0 && (
                    <span className="text-mut">belum tersambung</span>
                  )}
                  <div className="space-y-1.5">
                    {b.viaSplitter.map((r, i) => (
                      <div key={`vs-${i}`} className="flex flex-wrap items-center gap-1.5">
                        <CoreChip core={r.core} cableType={r.odc.cable_type} small />
                        <span className="rounded-md border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">
                          via {r.via.join(" → ")}
                        </span>
                      </div>
                    ))}
                    {b.viaLangsung.map((l) => (
                      <div key={`vl-${l.id}`} className="flex flex-wrap items-center gap-1.5">
                        <CoreChip core={l.odc_core} cableType={cableOdc} small />
                        <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          kabel langsung → core ODP {l.odp_core}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Core power milik ODP sendiri */}
                <div className="mt-3 text-xs">
                  <div className="mb-1 font-medium text-mut">Core power ODP:</div>
                  {b.powerCores.length === 0 && <span className="text-mut">belum dicatat</span>}
                  <div className="flex flex-wrap gap-1.5">
                    {b.powerCores.map((c) => (
                      <span key={c.id} className="flex items-center gap-1">
                        <CoreChip core={c.core} cableType={b.odp.cable_type} small />
                        <Badge cls={STATUS[c.status]?.cls ?? ""}>{STATUS[c.status]?.label ?? c.status}</Badge>
                        {c.destination && <span className="text-mut">→ {c.destination}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ---------- Tab 3: Rekap Core ---------- */}
      {tab === "rekap" && (
        <Card className="overflow-x-auto p-0">
          {!rekap ? (
            <div className="p-6 text-sm text-mut">Memuat…</div>
          ) : rekapFiltered.length === 0 ? (
            <div className="p-6"><Empty text="Tidak ada data sesuai filter." /></div>
          ) : (
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">Segmen</th>
                  <th className="th">Link</th>
                  <th className="th">Uplink</th>
                  <th className="th">Kabel</th>
                  <th className="th">Core</th>
                  <th className="th">Status</th>
                  <th className="th">Tujuan</th>
                </tr>
              </thead>
              <tbody>
                {rekapFiltered.map((r) => (
                  <tr key={r.id} className="border-b border-line-soft last:border-0">
                    <td className="td text-mut">{r.source === "olt_to_odc" ? "OLT → ODC" : "ODC → ODP"}</td>
                    <td className="td font-medium">{r.link_name ?? "-"}</td>
                    <td className="td text-mut">{r.uplink_name ?? "-"}</td>
                    <td className="td text-mut">{getCableInfo(r.cable_type)?.label ?? "-"}</td>
                    <td className="td"><CoreChip core={r.core} cableType={r.cable_type} small /></td>
                    <td className="td"><Badge cls={STATUS[r.status].cls}>{STATUS[r.status].label}</Badge></td>
                    <td className="td text-mut">{r.destination || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* ---------- Pratinjau PDF dalam aplikasi ---------- */}
      {pdfView && (
        <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={tutupPdf}>
          <div
            className="card flex h-[90vh] w-full max-w-5xl flex-col p-4"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <FileText size={16} className="text-acc" />
              <h2 className="text-sm font-semibold">{pdfView.nama}</h2>
              <div className="ml-auto flex flex-wrap gap-2">
                <a className="btn" href={pdfView.url} download={pdfView.nama}>
                  <Download size={14} /> Unduh
                </a>
                <a className="btn" href={pdfView.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> Tab Baru
                </a>
                <button className="btn" onClick={tutupPdf} aria-label="Tutup pratinjau">
                  <X size={14} /> Tutup
                </button>
              </div>
            </div>
            <PratinjauPdf bytes={pdfView.bytes} />
          </div>
        </div>
      )}

      <Toast toast={toastState} />
    </div>
  );
}
