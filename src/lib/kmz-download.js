import { MAP_ICONS } from "./map-icons.js";
import { createKmz } from "./kmz.js";

export async function downloadKmz(
  view,
  options,
  { isCurrent = () => true } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let entries;
  try {
    entries = await Promise.all(
      Object.entries(MAP_ICONS).map(async ([kind, url]) => {
        const response = await fetch(url, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            `Ikon lokal ${kind.toUpperCase()} gagal dimuat. Coba muat ulang aplikasi.`,
          );
        return [kind, new Uint8Array(await response.arrayBuffer())];
      }),
    );
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        "Aset KMZ terlalu lama dimuat. Periksa koneksi lalu ulangi ekspor.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  if (!isCurrent()) return;
  const blob = new Blob(
    [createKmz(view, options, Object.fromEntries(entries))],
    { type: "application/vnd.google-earth.kmz" },
  );
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `peta-jaringan-${options?.scope === "lengkap" ? "lengkap" : "terfilter"}-${new Date().toISOString().slice(0, 10)}.kmz`;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
