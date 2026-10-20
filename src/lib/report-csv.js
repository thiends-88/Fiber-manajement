export function reportDate(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function csvContent(head, rows) {
  const cell = (value) => {
    let text = String(value ?? "");
    // Cegah nama/catatan lapangan dijalankan sebagai formula oleh spreadsheet.
    if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [head, ...rows].map((row) => row.map(cell).join(";")).join("\r\n");
}

export function downloadCsv(name, head, rows) {
  const blob = new Blob([csvContent(head, rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = `${name}-${reportDate()}.csv`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
