'use client';

export function ResizeHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      title="Drag to resize"
      className="group flex h-full w-1.5 shrink-0 cursor-col-resize items-center justify-center"
    >
      <div className="h-full w-px bg-zinc-200 group-hover:bg-indigo-400 dark:bg-zinc-800" />
    </div>
  );
}
