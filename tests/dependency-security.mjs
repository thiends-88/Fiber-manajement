// Regresi advisori DOMPurify 29-10-2026; payload tidak pernah dieksekusi.
// Dependency produksi transitif jsPDF, bukan bukti jalur aplikasi memakai opsi rentan.
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
const dom = new JSDOM("<!doctype html><body></body>");
const { window } = dom,
  { document } = window;
let passed = 0,
  failed = 0;
function check(name, run) {
  try {
    run();
    passed++;
    console.log("OK   ", name);
  } catch (error) {
    failed++;
    console.error("GAGAL", name, "—", error.message);
  }
}
try {
  for (const hook of [
    "beforeSanitizeElements",
    "uponSanitizeElement",
    "afterSanitizeElements",
    "beforeSanitizeAttributes",
    "afterSanitizeAttributes",
  ]) {
    for (const mode of ["self", "parent", "nextSibling"]) {
      check(
        `${hook}: subtree ${mode} tidak menyisakan event handler (GHSA-mrv2-3pqr-j5jr)`,
        () => {
          const purify = createDOMPurify(window);
          document.body.innerHTML =
            '<div id="root"><figure><img class="bad" src="a.png"><img id="evil" src="x" onerror="alert(1)"></figure><p>ok</p></div>';
          const root = document.getElementById("root"),
            evil = document.getElementById("evil");
          purify.addHook(hook, (node) => {
            if (node.getAttribute?.("class") !== "bad") return;
            if (mode === "self") node.remove();
            if (mode === "parent") node.parentNode?.remove();
            if (mode === "nextSibling") node.nextElementSibling?.remove();
          });
          purify.sanitize(root, { IN_PLACE: true });
          assert.equal(evil.getAttribute("onerror"), null);
          assert.equal(root.querySelector("p")?.textContent, "ok");
        },
      );
    }
  }
  for (const [first, last] of [
    ["$", "{alert(1)}"],
    ["{", "{alert(1)}}"],
    ["<", "%alert(1)%>"],
  ]) {
    check(
      `shadow root membersihkan ekspresi template ${first}${last} (GHSA-cg2g-xh64-v4q7)`,
      () => {
        const purify = createDOMPurify(window),
          host = document.createElement("div");
        const shadow = host.attachShadow({ mode: "open" });
        shadow.append(
          document.createTextNode(first),
          document.createElement("object"),
          document.createTextNode(last),
        );
        purify.sanitize(host, { IN_PLACE: true, SAFE_FOR_TEMPLATES: true });
        shadow.normalize();
        assert.ok(
          !shadow.textContent.includes(first + last),
          shadow.textContent,
        );
      },
    );
  }
  check(
    "XHTML SVG tidak mempertahankan attributeName href aktif (GHSA-c6gr-qvv4-5v3f)",
    () => {
      const purify = createDOMPurify(window);
      const clean = purify.sanitize(
        '<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" values="x;javascript:alert(1)" dur="0.01s" fill="freeze"/></a></svg>',
        {
          PARSER_MEDIA_TYPE: "application/xhtml+xml",
          ALLOWED_TAGS: ["svg", "a", "animate"],
          ALLOWED_ATTR: ["attributeName", "values", "dur", "fill"],
        },
      );
      assert.ok(!/attributeName=["']href["']/i.test(clean), clean);
    },
  );
  console.log(
    `\nDEPENDENCY SECURITY DOMPurify ${createDOMPurify(window).version}: ${passed} lulus, ${failed} gagal.`,
  );
  if (failed) process.exitCode = 1;
} finally {
  window.close();
}
