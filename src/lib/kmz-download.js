import { MAP_ICONS } from "./map-icons.js";
import { buildKmzArchive } from "./kmz-export-client.js";

export async function downloadKmz(
  view,
  options,
  { isCurrent = () => true, signal } = {},
) {
  const controller = new AbortController();
  if (signal?.aborted) return;
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
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
    signal?.removeEventListener("abort", cancel);
  }
  if (!isCurrent() || signal?.aborted) return;
  const archive = await buildKmzArchive(
    view,
    options,
    Object.fromEntries(entries),
    signal,
  );
  if (!isCurrent() || signal?.aborted) return;
  const blob = new Blob([archive], {
    type: "application/vnd.google-earth.kmz",
  });
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
