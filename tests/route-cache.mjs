// Harness DOM terisolasi untuk hook cache, race dan pembatalan sesi jalur.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://route-cache.test/",
  pretendToBeVisual: true,
});
const { window } = dom;
window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
window.scrollTo = () => {};
for (const key of [
  "window",
  "document",
  "localStorage",
  "location",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: window[key],
  });
for (const key of [
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: window[key].bind(window),
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
try {
  console.log("\n=== JALUR CACHE / RACE / SESI ===");
  const { run } = await import("../.uji-routes/route-cache.js");
  await run();
} finally {
  dom.window.close();
}
