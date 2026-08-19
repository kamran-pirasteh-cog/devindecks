'use client';

/**
 * The "Coming soon" surface — one place that says what's being built, rather
 * than a coming-soon badge on every half-finished corner of the app.
 *
 * `ComingSoonLink` is plain blue text on purpose: it sits beside Export in the
 * editor header, and a second button there would read as a second action of
 * equal weight. It only becomes a dialog once it's clicked.
 *
 * The Reporting section holds the reports preview that used to be the Reports
 * tab's whole content: the layout is worth showing, but it belongs with the
 * other not-yet-shipped things rather than posing as a working tab.
 */
import { useEffect, useRef, useState } from 'react';
import type { Deck } from '@/model';
import { listDocs } from '@/docs/repository';
import { MODAL_Z } from '@/editor/layers';
import { Reports } from '@/home/Reports';

export type ComingSoonSection = 'collaboration' | 'reporting';

/** Blue text, no chrome — see the file comment. */
export function ComingSoonLink({
  label = 'Coming soon',
  section,
  className = '',
}: {
  label?: string;
  /** Which section to open on, when the link is next to that feature. */
  section?: ComingSoonSection;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="What's coming to Decks"
        className={`rounded text-xs font-medium text-blue-600 hover:underline dark:text-blue-400 ${className}`}
      >
        {label}
      </button>
      {open ? <ComingSoonModal section={section} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {items.map((t) => (
        <li key={t} className="flex gap-2 text-[13px] text-zinc-600 dark:text-zinc-300">
          <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-blue-500" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({
  id,
  title,
  blurb,
  children,
}: {
  id: ComingSoonSection;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section id={`coming-soon-${id}`} className="scroll-mt-4">
      <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">{blurb}</p>
      {children}
    </section>
  );
}

/**
 * A still of the commenting UI. The real thing exists behind `FLAGS.comments`,
 * but a screenshot of a feature is the wrong thing to gate — this is a sketch,
 * drawn here, so it can't drift into looking clickable.
 */
function CollaborationPreview() {
  return (
    <div
      inert
      className="mt-3 select-none rounded-lg border border-zinc-200 bg-zinc-50 p-3 opacity-60 grayscale dark:border-zinc-800 dark:bg-zinc-900/60"
    >
      <div className="flex items-center gap-2 pb-2">
        <div className="flex -space-x-1.5">
          {['A', 'M', 'J'].map((initial) => (
            <span
              key={initial}
              className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-indigo-500 text-[10px] font-semibold text-white dark:border-zinc-900"
            >
              {initial}
            </span>
          ))}
        </div>
        <span className="text-[11px] text-zinc-500">3 people in this deck</span>
      </div>
      <div className="space-y-2">
        <div className="rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
            Ava · on “Q3 pipeline” <span className="font-normal text-zinc-400">2m ago</span>
          </div>
          <p className="mt-0.5 text-[12px] text-zinc-600 dark:text-zinc-300">
            Can we pull the ARR number straight from the source instead of hard-coding it?
          </p>
        </div>
        <div className="ml-5 rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
            You <span className="font-normal text-zinc-400">just now</span>
          </div>
          <p className="mt-0.5 text-[12px] text-zinc-600 dark:text-zinc-300">
            Done — @maria can you confirm the cut-off date?
          </p>
        </div>
      </div>
    </div>
  );
}

export function ComingSoonModal({
  section,
  onClose,
}: {
  section?: ComingSoonSection;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<Deck[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The reports preview shows each report against the deck it delivers, so it
  // needs the deck list. Read on mount: it comes from local storage.
  useEffect(() => setDocs(listDocs()), []);

  // Esc closes. Capture phase, because the editor's own window-level Escape
  // handler would otherwise clear the canvas selection behind the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Opened from beside a particular feature? Start at that section.
  useEffect(() => {
    if (!section) return;
    bodyRef.current
      ?.querySelector(`#coming-soon-${section}`)
      ?.scrollIntoView({ block: 'start' });
  }, [section]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Coming soon"
      onClick={onClose}
      style={{ zIndex: MODAL_Z }}
      className="fixed inset-0 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white text-left shadow-2xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Coming soon
            </h2>
            <span className="text-[11px] text-zinc-400">
              Previews of what&rsquo;s being built — nothing here is live yet
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        <div ref={bodyRef} className="space-y-8 overflow-y-auto px-5 py-4">
          <Section
            id="collaboration"
            title="Live collaboration and commenting"
            blurb="Two people in the same deck at the same time, and a conversation attached to the slide it's about."
          >
            <Bullets
              items={[
                'Live cursors and presence, so you can see who is on which slide.',
                'Edits from everyone applied as they happen — no more “final_v3”.',
                'Comment threads pinned to a slide or a single object, with replies and resolve.',
                '@mentions that notify, and a panel that lists every open thread in the deck.',
              ]}
            />
            <CollaborationPreview />
          </Section>

          <Section
            id="reporting"
            title="Reporting"
            blurb="A deck that re-sends itself on a schedule, with its numbers refreshed and an approval step before it goes out."
          >
            <Bullets
              items={[
                'Recurring sends — daily, weekly or monthly — to a recipient list per report.',
                'Data pulled at send time, so the deck that lands is the current one.',
                'An approval queue for reports that shouldn’t leave without a human in the loop.',
                'Owners, client tags and status filters over every report in the workspace.',
              ]}
            />
            {/* The preview moved here from the Reports tab. It draws itself
                dimmed and `inert`, so nothing in it can be clicked. */}
            <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <Reports docs={docs} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
