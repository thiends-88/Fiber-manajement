import { ArrowUp, Cable, Layers, Workflow } from "lucide-react";

export default function DeviceEditorHeader({ kind, device, parent, canWrite, navigation }) {
  const titleId = `${kind.toLowerCase()}-input-title`;
  return (
    <div className="mb-4 rounded-xl border border-acc/30 bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <p className="mb-1 text-xs font-medium text-acc">Perangkat dipilih</p>
          <h2
            id={titleId}
            ref={navigation.editorRef}
            tabIndex={-1}
            data-device-id={device.id}
            className="scroll-mt-24 break-words text-base font-semibold focus:outline-none"
          >
            Area input {kind} · {device.name}
          </h2>
          <p className="mt-1 break-words text-xs text-mut">{parent}</p>
          <p className="mt-1 text-xs text-mut">
            {canWrite ? "Pilih bagian di bawah untuk langsung mengisi data perangkat ini." : "Mode baca — data dapat dilihat, perubahan dinonaktifkan."}
          </p>
        </div>
        <button type="button" className="btn shrink-0 text-xs" onClick={navigation.back}>
          <ArrowUp size={14} /> Kembali ke daftar {kind}
        </button>
      </div>
      <nav aria-label={`Bagian ${kind} terpilih`} className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
        <button type="button" className="btn text-xs" onClick={() => navigation.jump(navigation.coreRef)}>
          <Cable size={14} /> Core
        </button>
        <button type="button" className="btn text-xs" onClick={() => navigation.jump(navigation.firstRef)}>
          <Workflow size={14} /> {kind === "ODC" ? "Interface feeder" : "Asal interface"}
        </button>
        <button type="button" className="btn text-xs" onClick={() => navigation.jump(navigation.splitterRef)}>
          <Layers size={14} /> Splitter
        </button>
      </nav>
    </div>
  );
}
