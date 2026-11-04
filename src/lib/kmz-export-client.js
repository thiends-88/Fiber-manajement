// Pembuatan XML/ZIP juga di worker agar ekspor jalur besar tidak membekukan UI.
export function buildKmzArchive(view, options, icons, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException("Ekspor dibatalkan", "AbortError"));
    let worker,
      timer,
      disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      worker?.terminate();
      signal?.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      dispose();
      reject(new DOMException("Ekspor dibatalkan", "AbortError"));
    };
    try {
      worker = new Worker(
        new URL("../workers/kmz-export.worker.js", import.meta.url),
        { type: "module" },
      );
      signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => {
        dispose();
        reject(
          new Error("Pembuatan KMZ terlalu lama. Coba cakupan lebih kecil."),
        );
      }, 30000);
      worker.onmessage = ({ data }) => {
        if (disposed) return;
        dispose();
        if (
          !data?.ok ||
          !(data.buffer instanceof ArrayBuffer) ||
          data.buffer.byteLength < 4
        ) {
          reject(new Error(data?.error || "Arsip KMZ gagal dibuat."));
          return;
        }
        resolve(new Uint8Array(data.buffer));
      };
      worker.onerror = () => {
        if (disposed) return;
        dispose();
        reject(
          new Error(
            "Worker KMZ gagal dimuat. Muat ulang halaman lalu coba lagi.",
          ),
        );
      };
      const snapshot = {
        points: view.points,
        missing: view.missing,
      };
      worker.postMessage(
        { view: snapshot, options, icons },
        Object.values(icons).map((bytes) => bytes.buffer),
      );
    } catch {
      dispose();
      reject(
        new Error(
          "Browser tidak dapat menjalankan ekspor latar belakang. Gunakan browser terbaru.",
        ),
      );
    }
  });
}
