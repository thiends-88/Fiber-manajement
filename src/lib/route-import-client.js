import { ROUTE_LIMITS } from "./cable-routes.js";

export function startRouteImport(file) {
  let worker,
    timer,
    rejectTask,
    disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    worker?.terminate();
  };
  const promise = new Promise((resolve, reject) => {
    rejectTask = reject;
    if (!file?.size || file.size > ROUTE_LIMITS.fileBytes) {
      dispose();
      return reject(new Error("Pilih berkas KMZ/KML/XML/CSV maksimal 3 MB."));
    }
    if (typeof Worker === "undefined") {
      dispose();
      return reject(
        new Error(
          "Browser belum mendukung pemrosesan impor di latar belakang. Gunakan browser terbaru.",
        ),
      );
    }
    try {
      worker = new Worker(
        new URL("../workers/route-import.worker.js", import.meta.url),
        { type: "module" },
      );
      timer = setTimeout(() => {
        dispose();
        reject(
          new Error(
            "Pembacaan jalur terlalu lama. Bagi berkas menjadi beberapa bagian.",
          ),
        );
      }, 30000);
      worker.onmessage = ({ data }) => {
        if (disposed) return;
        dispose();
        if (data?.ok && data.result && typeof data.result === "object")
          resolve(data.result);
        else reject(new Error(data?.error || "Gagal membaca jalur."));
      };
      worker.onerror = () => {
        if (disposed) return;
        dispose();
        reject(
          new Error(
            "Worker impor tidak dapat dimuat. Muat ulang halaman lalu coba lagi.",
          ),
        );
      };
      file
        .arrayBuffer()
        .then((buffer) => {
          if (!disposed)
            worker.postMessage({ buffer, name: file.name }, [buffer]);
        })
        .catch((error) => {
          dispose();
          reject(error);
        });
    } catch {
      dispose();
      reject(
        new Error(
          "Pemrosesan impor tidak dapat dimulai. Muat ulang halaman lalu coba lagi.",
        ),
      );
    }
  });
  return {
    promise,
    cancel: () => {
      if (disposed) return;
      dispose();
      rejectTask?.(new DOMException("Impor dibatalkan", "AbortError"));
    },
  };
}
