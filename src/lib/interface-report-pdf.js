import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { interfaceLabel } from "./interfaces.js";
import { summarizeInterfaceReport } from "./interface-report.js";

// Helvetica bawaan PDF tidak memiliki glif panah. Gunakan teks biasa agar
// urutan sambungan tetap terbaca pada PDF tanpa mengunduh font eksternal.
export function pdfReportText(value) {
  return String(value ?? "").replaceAll("→", " -> ").replaceAll("⇉", " >> ").replaceAll("⇄", " <-> ").replace(/[·•]/g, " / ").replace(/[—–…]/g, "-")
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

export function createInterfaceReportPdf(items, { filterDescription = "Semua OLT / semua interface", generatedAt = new Date() } = {}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setProperties({ title: "Laporan Per Interface OLT", subject: filterDescription, creator: "FiberOps" });
  const margin = 14, width = doc.internal.pageSize.getWidth() - margin * 2;
  const total = summarizeInterfaceReport(items);
  const timestamp = generatedAt.toLocaleString("id-ID", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  const split = (value, size = 8, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size);
    return doc.splitTextToSize(pdfReportText(value), width);
  };
  const filterLines = split(`Filter: ${filterDescription}`);
  const summary = `${total.interfaces} interface / ${total.unmapped} kelompok belum dipetakan / ${total.odcs} ODC / ${total.odps} ODP unik / ${total.rows} baris`;
  const bodyTop = 29 + filterLines.length * 3.8;
  let cursor = bodyTop;

  function sectionLines(item) {
    const olt = item.olt?.name || item.port?.olt_name || "OLT belum diketahui";
    return [
      { lines: split(`${olt} / ${item.port ? interfaceLabel(item.port) : `Belum dipetakan: ${item.groups[0].odc.name}`}`, 11, true), size: 11, lineHeight: 4.8, bold: true },
      { lines: split(item.unmapped ? `Induk OLT administratif; bukan konfirmasi sumber. ${item.reason}`
        : `Status port tercatat: ${item.status}${item.port.interface_cli ? ` / CLI: ${item.port.interface_cli}` : ""}`), size: 8, lineHeight: 3.8 },
      { lines: split(`${item.odcIds.size} ODC / ${item.odpIds.size} ODP unik / ${item.rows.length} baris jalur`), size: 8, lineHeight: 3.8 },
    ];
  }
  function drawSection(lines, top) {
    let y = top;
    for (const l of lines) {
      doc.setFont("helvetica", l.bold ? "bold" : "normal"); doc.setFontSize(l.size); doc.setTextColor(l.bold ? 25 : 90);
      doc.text(l.lines, margin, y, { lineHeightFactor: l.lineHeight / (l.size * 25.4 / 72) });
      y += l.lines.length * l.lineHeight + 1;
    }
    doc.setFont("helvetica", "normal"); doc.setTextColor(0);
    return y + 1;
  }

  if (!items.length) {
    doc.setFontSize(10); doc.text("Tidak ada data sesuai filter.", margin, cursor);
  }
  for (const item of items) {
    const heading = sectionLines(item);
    const headingHeight = heading.reduce((n, l) => n + l.lines.length * l.lineHeight + 1, 1);
    // Sisakan tempat untuk judul kolom dan setidaknya satu baris data.
    if (cursor + headingHeight + 24 > doc.internal.pageSize.getHeight() - 14) { doc.addPage(); cursor = bodyTop; }
    const tableTop = drawSection(heading, cursor);
    autoTable(doc, {
      head: [["ODC / core feeder", "Jalur lengkap", "ODP / ujung jalur", "Lokasi tujuan", "Kondisi / catatan"]],
      body: item.rows.map((r) => [
        r.odc ? `${r.odc.name}\n${r.core == null ? "Core belum diisi" : `Core ${r.core} / ${r.color} / Tube ${r.tube}`}` : "Belum dipetakan",
        r.path, r.target, r.location || "-", [r.sourceReason, r.condition, r.notes, ...item.issues].filter(Boolean).join("\n"),
      ].map(pdfReportText)),
      startY: tableTop,
      margin: { left: margin, right: margin, top: bodyTop + headingHeight, bottom: 14 },
      styles: { font: "helvetica", fontSize: 8, cellPadding: 2, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: [16, 98, 134], textColor: 255, fontSize: 8 },
      alternateRowStyles: { fillColor: [244, 248, 250] },
      columnStyles: { 0: { cellWidth: 39 }, 1: { cellWidth: width - 159 }, 2: { cellWidth: 36 }, 3: { cellWidth: 40 }, 4: { cellWidth: 44 } },
      rowPageBreak: "avoid",
      willDrawPage: (data) => { if (data.pageNumber > 1) drawSection(heading, bodyTop); },
    });
    cursor = doc.lastAutoTable.finalY + 10;
  }

  // Header/footer ditulis setelah semua tabel agar nomor halaman memakai total
  // akhir, dan setiap halaman tetap menyimpan konteks filter + interface.
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(25);
    doc.text("Laporan Per Interface OLT", margin, 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(90);
    doc.text(pdfReportText(`Dicetak: ${timestamp} / ${summary}`), margin, 17);
    doc.text(filterLines, margin, 21, { lineHeightFactor: 1.34 });
    doc.text("Data pencatatan manual, bukan status online. ODP dihitung unik; sambungan yang berbeda tetap ditulis terpisah.", margin, bodyTop - 4);
    doc.setFontSize(8); doc.setTextColor(130);
    doc.text(`FiberOps / Laporan Per Interface / hal. ${page} dari ${pages}`, margin, doc.internal.pageSize.getHeight() - 6);
  }
  return doc;
}
