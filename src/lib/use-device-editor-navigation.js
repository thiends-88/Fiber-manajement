import { useCallback, useEffect, useRef } from "react";

// Navigasi tampilan saja: tidak mengirim request atau mengubah data perangkat.
// Judul berada sebelum panel async, sehingga panel yang selesai dimuat tidak
// mendorong target. Wrapper editor menyediakan tinggi minimum viewport agar bisa
// digulir tepat sejak loading. Satu frame, tanpa polling/observer atau animasi panjang.
export function useDeviceEditorNavigation({ selectedId, onSelect, blocked = false }) {
  const editorRef = useRef(null);
  const listRef = useRef(null);
  const rowRef = useRef(null);
  const firstRef = useRef(null);
  const coreRef = useRef(null);
  const splitterRef = useRef(null);
  const handled = useRef(null);
  const frame = useRef(null);

  const cancel = useCallback(() => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const jump = useCallback((ref, done) => {
    cancel();
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      const target = ref.current;
      // Jangan merebut fokus dari modal edit/core/splitter yang sudah terbuka.
      if (!target?.isConnected || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      target.focus?.({ preventScroll: true });
      target.scrollIntoView?.({ behavior: "instant", block: "start", inline: "nearest" });
      done?.();
    });
  }, [cancel]);

  useEffect(() => {
    cancel();
    if (!selectedId) handled.current = null;
    else if (blocked) handled.current = selectedId;
    else if (handled.current !== selectedId) {
      // Tandai sesudah frame berhasil agar mount ulang effect StrictMode tetap
      // melakukan satu navigasi; refresh data ID sama tidak mengulang scroll.
      jump(editorRef, () => { handled.current = selectedId; });
    }
    return cancel;
  }, [selectedId, blocked, jump, cancel]);

  const open = useCallback((id) => {
    if (blocked || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    if (id === selectedId) jump(editorRef, () => { handled.current = id; });
    else onSelect(id);
  }, [selectedId, onSelect, blocked, jump]);

  const back = useCallback(() => {
    if (!blocked) jump(rowRef.current ? rowRef : listRef);
  }, [blocked, jump]);

  return { editorRef, listRef, rowRef, firstRef, coreRef, splitterRef, open, back, jump };
}
