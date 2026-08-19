'use client';

/** Header "Export" button: dropdown with .pptx / .pdf / .html. */
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@/store/editorStore';
import { EXPORT_FORMATS, runExport, type ExportKind } from '@/export/formats';
import { OVERLAY_Z } from './layers';

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const run = (kind: ExportKind) => {
    const s = useEditor.getState();
    runExport(kind, s.deck, s.designSystem);
    setOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Export"
        className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
      >
        Export
      </button>

      {open ? (
        <div
          style={{ zIndex: OVERLAY_Z }}
          className="absolute right-0 top-8 w-44 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
        >
          {EXPORT_FORMATS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => run(opt.key)}
              className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
