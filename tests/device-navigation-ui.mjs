// DOM terisolasi, seluruh API dimock read-only. Geometri/keyboard nyata diuji di browser.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://navigation-ui.test/", pretendToBeVisual: true });
const { window } = dom;
const frames = new Map(), scrolls = [];
let nextFrame = 0;
window.requestAnimationFrame = callback => { const id = ++nextFrame;frames.set(id, callback);return id; };
window.cancelAnimationFrame = id => frames.delete(id);
window.Element.prototype.scrollIntoView = function (options) { scrolls.push({ target: this, options }); };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
window.scrollTo = () => {};
window.confirm = () => false;
for (const key of ["window", "document", "localStorage", "location", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "ResizeObserver", "IntersectionObserver", "confirm"]) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] });
}
for (const key of ["requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "matchMedia"]) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key].bind(window) });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
function flushFrames() {
  const current = [...frames];frames.clear();
  for (const [, callback] of current) callback(performance.now());
}
try {
  console.log("\n=== NAVIGASI ODC / ODP — DOM READ-ONLY ===");
  const { run } = await import("../.uji-navigation/device-navigation-ui.js");
  await run({ frames, scrolls, flushFrames });
} finally { dom.window.close(); }
