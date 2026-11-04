import { parseRouteFile } from "../lib/route-import.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      ok: true,
      result: parseRouteFile(data.buffer, data.name),
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error.message || "Berkas jalur tidak dapat dibaca.",
    });
  }
};
