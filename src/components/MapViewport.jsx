import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Maximize2, Minimize2 } from "lucide-react";

// Memenuhi viewport aplikasi, termasuk di iframe/ponsel tanpa izin Fullscreen API.
// Pohon DOM peta tidak dipindah/remount: zoom, layer dan popup tetap dipertahankan.
const MapViewport = forwardRef(function MapViewport(
  { children, ready, pointCount, routeCount, onResize },
  ref,
) {
  const [fullPage, setFullPage] = useState(false);
  const shell = useRef(null),
    toggle = useRef(null),
    resize = useRef(onResize);
  const stageId = useId();
  resize.current = onResize;
  useImperativeHandle(ref, () => ({ close: () => setFullPage(false) }), []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => resize.current?.());
    return () => cancelAnimationFrame(frame);
  }, [fullPage]);

  useEffect(() => {
    if (!fullPage) return;
    const previousFocus = document.activeElement;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    toggle.current?.focus({ preventScroll: true });
    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setFullPage(false);
        return;
      }
      if (event.key !== "Tab") return;
      const elements = [
        ...shell.current.querySelectorAll(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter(
        (element) =>
          element.tabIndex >= 0 && element.getClientRects().length > 0,
      );
      const first = elements[0],
        last = elements.at(-1);
      if (!first) {
        event.preventDefault();
        shell.current.focus({ preventScroll: true });
      } else if (
        !shell.current.contains(document.activeElement) ||
        (!event.shiftKey && document.activeElement === last) ||
        (event.shiftKey && document.activeElement === first)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [fullPage]);

  return (
    <div
      ref={shell}
      className={`network-map-shell${fullPage ? " network-map-fullpage" : ""}`}
      data-map-fullpage={String(fullPage)}
      role={fullPage ? "dialog" : undefined}
      aria-modal={fullPage ? "true" : undefined}
      aria-label={fullPage ? "Peta jaringan layar penuh" : undefined}
      tabIndex={fullPage ? -1 : undefined}
    >
      <div
        className="network-map-toolbar"
        role="toolbar"
        aria-label="Kontrol tampilan peta"
      >
        {fullPage && (
          <div className="network-map-fullpage-heading">
            <strong>Peta jaringan</strong>
            <span>
              {pointCount} titik perangkat · {routeCount} segmen jalur impor
            </span>
          </div>
        )}
        <button
          ref={toggle}
          type="button"
          className="btn network-map-fullpage-toggle"
          disabled={!ready}
          aria-expanded={fullPage}
          aria-controls={stageId}
          onClick={() => setFullPage((current) => !current)}
        >
          {fullPage ? (
            <Minimize2 size={16} aria-hidden="true" />
          ) : (
            <Maximize2 size={16} aria-hidden="true" />
          )}
          {fullPage ? "Keluar layar penuh" : "Peta layar penuh"}
        </button>
      </div>
      <div className="network-map-stage" id={stageId}>
        {children}
      </div>
    </div>
  );
});

export default MapViewport;
