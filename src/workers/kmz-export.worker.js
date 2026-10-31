import { createKmz } from "../lib/kmz.js";
self.onmessage = ({ data }) => {
  try {
    const bytes = createKmz(data.view, data.options, data.icons);
    self.postMessage({ ok: true, buffer: bytes.buffer }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error.message || "KMZ tidak dapat dibuat.",
    });
  }
};
