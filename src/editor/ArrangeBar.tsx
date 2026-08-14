'use client';

/**
 * Arrange bar — the placement counterpart to the SelectionFormatBar. Where that
 * bar sits above the slide and formats what's selected, this one sits down its
 * right edge and arranges it: stacking order, align, distribute, match size,
 * match format. It appears as soon as anything is selected — order and align
 * both mean something for one object — and the relational actions below stay
 * disabled until there are enough objects for them to act on.
 *
 * Like the format bar it's a thin trigger surface — every button calls a store
 * action, so the toolbar, the context menu and Devin all stay in sync for free.
 * The `dd-format-bar` class is load-bearing: the canvas's mousedown resolver and
 * Selecto both check for it so clicking a button neither collapses the
 * selection nor starts a marquee.
 *
 * "Match size" and "match format" both read the FIRST object in the selection
 * as their reference, which is PowerPoint's rule and the same one the format
 * painter uses. Their tooltips say so, because that ordering isn't visible.
 */
import { canGroup, canUngroup } from '@/model';
import { useEditor, type AlignMode } from '@/store/editorStore';
import { OVERLAY_Z } from './layers';

/** A filled object in an icon. */
const Box = (p: { x: number; y: number; w: number; h: number }) => (
  <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={0.75} fill="currentColor" stroke="none" />
);

/** The edge an align icon pulls its objects to. */
const Edge = (p: { x1: number; y1: number; x2: number; y2: number }) => (
  <line {...p} strokeLinecap="round" />
);

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
    >
      {children}
    </svg>
  );
}

const ALIGN: { mode: AlignMode; title: string; icon: React.ReactNode }[] = [
  {
    mode: 'left',
    title: 'Align left',
    icon: (
      <>
        <Edge x1={1.5} y1={2} x2={1.5} y2={14} />
        <Box x={3.5} y={3.5} w={9} h={3.5} />
        <Box x={3.5} y={9} w={5.5} h={3.5} />
      </>
    ),
  },
  {
    mode: 'hcenter',
    title: 'Align center',
    icon: (
      <>
        <Edge x1={8} y1={2} x2={8} y2={14} />
        <Box x={3.5} y={3.5} w={9} h={3.5} />
        <Box x={5.25} y={9} w={5.5} h={3.5} />
      </>
    ),
  },
  {
    mode: 'right',
    title: 'Align right',
    icon: (
      <>
        <Edge x1={14.5} y1={2} x2={14.5} y2={14} />
        <Box x={3.5} y={3.5} w={9} h={3.5} />
        <Box x={7} y={9} w={5.5} h={3.5} />
      </>
    ),
  },
  {
    mode: 'top',
    title: 'Align top',
    icon: (
      <>
        <Edge x1={2} y1={1.5} x2={14} y2={1.5} />
        <Box x={3.5} y={3.5} w={3.5} h={9} />
        <Box x={9} y={3.5} w={3.5} h={5.5} />
      </>
    ),
  },
  {
    mode: 'vcenter',
    title: 'Align middle',
    icon: (
      <>
        <Edge x1={2} y1={8} x2={14} y2={8} />
        <Box x={3.5} y={3.5} w={3.5} h={9} />
        <Box x={9} y={5.25} w={3.5} h={5.5} />
      </>
    ),
  },
  {
    mode: 'bottom',
    title: 'Align bottom',
    icon: (
      <>
        <Edge x1={2} y1={14.5} x2={14} y2={14.5} />
        <Box x={3.5} y={3.5} w={3.5} h={9} />
        <Box x={9} y={7} w={3.5} h={5.5} />
      </>
    ),
  },
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
    <div className="group relative flex">
      <button
        type="button"
        onClick={onClick}
        aria-label={title}
        disabled={disabled}
        className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {children}
      </button>
      {/* Tooltips open to the LEFT, over the slide: the bar lives in the thin
          strip of workspace padding, so there is nothing to the right of it. */}
      <span
        style={{ zIndex: OVERLAY_Z }}
        className="pointer-events-none absolute right-full top-1/2 mr-1.5 -translate-y-1/2 whitespace-nowrap rounded-md bg-zinc-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity delay-300 group-hover:opacity-100 dark:bg-zinc-700"
      >
        {title}
      </span>
    </div>
  );
}

const Divider = () => <div className="my-0.5 h-px w-5 bg-zinc-200 dark:bg-zinc-700" />;

export function ArrangeBar() {
  const selectedIds = useEditor((s) => s.selectedIds);
  const editingId = useEditor((s) => s.editingId);
  const align = useEditor((s) => s.align);
  const distribute = useEditor((s) => s.distribute);
  const matchSize = useEditor((s) => s.matchSize);
  const matchFormat = useEditor((s) => s.matchFormat);
  const group = useEditor((s) => s.group);
  const ungroup = useEditor((s) => s.ungroup);
  const reorder = useEditor((s) => s.reorder);
  const elements = useEditor((s) => s.currentSlide().elements);

  // Nothing selected is nothing to arrange, and a caret in a text box means the
  // user is writing, not laying out.
  if (selectedIds.length < 1 || editingId) return null;
  /** Relational actions need a second object to measure against. */
  const single = selectedIds.length < 2;

  return (
    <div
      // See the module comment: the canvas keys off this class.
      className="dd-format-bar flex flex-col items-center gap-0.5 rounded-lg border border-zinc-200 bg-white px-1 py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      role="toolbar"
      aria-label="Arrange selection"
      aria-orientation="vertical"
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* Stacking order first: it's the one cluster that works on a single
          object, so it heads the bar rather than sitting below actions that are
          greyed out. */}
      {/* The filled box is the selection, the dashed one its neighbour; SVG
          paints in document order, so the filled box comes last to read as in
          front and first to read as behind. */}
      <Btn onClick={() => reorder('front')} title="Bring to front">
        <Icon>
          <rect x={6} y={6} width={8} height={8} rx={1} strokeDasharray="2 1.5" />
          <Box x={2} y={2} w={8} h={8} />
        </Icon>
      </Btn>
      <Btn onClick={() => reorder('back')} title="Send to back">
        <Icon>
          <Box x={2} y={2} w={8} h={8} />
          <rect x={6} y={6} width={8} height={8} rx={1} strokeDasharray="2 1.5" />
        </Icon>
      </Btn>

      <Divider />

      {/* Group next: it changes what the buttons below act on — after ⌘G the
          align buttons see one object, not several. */}
      <Btn
        onClick={() => group()}
        title="Group (⌘G)"
        disabled={!canGroup(elements, selectedIds)}
      >
        <Icon>
          <rect x={2.5} y={2.5} width={11} height={11} rx={1} strokeDasharray="2 1.5" />
          <Box x={4} y={4} w={4} h={4} />
          <Box x={8} y={8} w={4} h={4} />
        </Icon>
      </Btn>
      <Btn
        onClick={() => ungroup()}
        title="Ungroup (⌘⌥G)"
        disabled={!canUngroup(elements, selectedIds)}
      >
        <Icon>
          <Box x={1.5} y={2} w={5} h={5} />
          <Box x={9.5} y={9} w={5} h={5} />
        </Icon>
      </Btn>

      <Divider />

      {ALIGN.map((a) => (
        <Btn key={a.mode} onClick={() => align(a.mode)} title={a.title}>
          <Icon>{a.icon}</Icon>
        </Btn>
      ))}

      <Divider />

      {/* Distribution needs a middle object to move, so it stays disabled — not
          hidden — at two, keeping the bar's rows from shifting under the cursor. */}
      <Btn
        onClick={() => distribute('h')}
        title="Distribute horizontally"
        disabled={selectedIds.length < 3}
      >
        <Icon>
          <Box x={1.5} y={3} w={2} h={10} />
          <Box x={7} y={3} w={2} h={10} />
          <Box x={12.5} y={3} w={2} h={10} />
        </Icon>
      </Btn>
      <Btn
        onClick={() => distribute('v')}
        title="Distribute vertically"
        disabled={selectedIds.length < 3}
      >
        <Icon>
          <Box x={3} y={1.5} w={10} h={2} />
          <Box x={3} y={7} w={10} h={2} />
          <Box x={3} y={12.5} w={10} h={2} />
        </Icon>
      </Btn>

      <Divider />

      <Btn onClick={matchSize} title="Make same size as first selected" disabled={single}>
        <Icon>
          <rect x={1.5} y={1.5} width={8} height={8} rx={1} />
          <rect x={6.5} y={6.5} width={8} height={8} rx={1} />
        </Icon>
      </Btn>
      <Btn onClick={matchFormat} title="Apply format of first selected" disabled={single}>
        <Icon>
          {/* Brush: handle out to the top-right, head sweeping down-left. */}
          <path d="M13.5 2.5 9.5 6.5" />
          <path d="M10.5 5.5 4 12 4.5 14 6.5 13.5 13 7z" />
        </Icon>
      </Btn>
    </div>
  );
}
