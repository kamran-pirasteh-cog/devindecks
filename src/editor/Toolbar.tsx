'use client';

/**
 * Toolbar — thin trigger surface over the command layer. Every button calls a
 * store action; it holds no logic of its own. The same actions back the future
 * Devin chat.
 */
import { useEditor, type AlignMode } from '@/store/editorStore';
import { makeLine, makeShape, makeText } from './factories';
import type { ShapePreset } from '@/model';

const SHAPES: { preset: ShapePreset; label: string }[] = [
  { preset: 'rect', label: '▭' },
  { preset: 'roundRect', label: '▢' },
  { preset: 'ellipse', label: '◯' },
  { preset: 'triangle', label: '△' },
  { preset: 'diamond', label: '◇' },
  { preset: 'rightArrow', label: '→' },
  { preset: 'chevron', label: '⌦' },
  { preset: 'pill', label: '⬭' },
];

const ALIGN: { mode: AlignMode; label: string; title: string }[] = [
  { mode: 'left', label: '⇤', title: 'Align left' },
  { mode: 'hcenter', label: '⇔', title: 'Align center' },
  { mode: 'right', label: '⇥', title: 'Align right' },
  { mode: 'top', label: '⤒', title: 'Align top' },
  { mode: 'vcenter', label: '⇕', title: 'Align middle' },
  { mode: 'bottom', label: '⤓', title: 'Align bottom' },
];

function Btn({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

const Divider = () => <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />;

export function Toolbar() {
  const addElement = useEditor((s) => s.addElement);
  const align = useEditor((s) => s.align);
  const distribute = useEditor((s) => s.distribute);
  const reorder = useEditor((s) => s.reorder);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const selCount = useEditor((s) => s.selectedIds.length);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  return (
    <div className="flex items-center gap-0.5 border-b border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950">
      <Btn onClick={() => addElement(makeText())} title="Add text">
        <span className="font-serif">T</span>
      </Btn>
      <Btn onClick={() => addElement(makeLine())} title="Add line">
        ╱
      </Btn>
      <Divider />
      {SHAPES.map((s) => (
        <Btn key={s.preset} onClick={() => addElement(makeShape(s.preset))} title={`Add ${s.preset}`}>
          {s.label}
        </Btn>
      ))}
      <Divider />
      {ALIGN.map((a) => (
        <Btn key={a.mode} onClick={() => align(a.mode)} title={a.title} disabled={selCount < 2}>
          {a.label}
        </Btn>
      ))}
      <Btn onClick={() => distribute('h')} title="Distribute horizontally" disabled={selCount < 3}>
        ☰
      </Btn>
      <Btn onClick={() => distribute('v')} title="Distribute vertically" disabled={selCount < 3}>
        ☷
      </Btn>
      <Divider />
      <Btn onClick={() => reorder('front')} title="Bring to front" disabled={selCount < 1}>
        ⬆
      </Btn>
      <Btn onClick={() => reorder('back')} title="Send to back" disabled={selCount < 1}>
        ⬇
      </Btn>
      <Divider />
      <Btn onClick={deleteSelected} title="Delete" disabled={selCount < 1}>
        🗑
      </Btn>
      <div className="flex-1" />
      <Btn onClick={undo} title="Undo" disabled={!canUndo}>
        ↺
      </Btn>
      <Btn onClick={redo} title="Redo" disabled={!canRedo}>
        ↻
      </Btn>
    </div>
  );
}
