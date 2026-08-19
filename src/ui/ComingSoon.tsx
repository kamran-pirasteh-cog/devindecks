'use client';

/**
 * The "Coming soon" surface — one place that says what's being built, rather
 * than a coming-soon badge on every half-finished corner of the app.
 *
 * `ComingSoonLink` is plain blue text on purpose: it sits beside New on the
 * dashboard and beside Export in the editor header, and a second button in
 * either place would read as a second action of equal weight. It only becomes
 * a dialog once it's clicked.
 *
 * The Reporting section holds the reports preview that used to be the Reports
 * tab's whole content: the layout is worth showing, but it belongs with the
 * other not-yet-shipped things rather than posing as a working tab, so the tab
 * itself is gone.
 */
import { useEffect, useRef, useState } from 'react';
import type { Deck } from '@/model';
import { listDocs } from '@/docs/repository';
import { MODAL_Z } from '@/editor/layers';
import { Reports } from '@/home/Reports';

export type ComingSoonSection = 'collaboration' | 'reporting' | 'ingestion';

/** Blue text, no chrome — see the file comment. */
export function ComingSoonLink({
  label = 'Product Roadmap',
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
 *
 * Drawn in full colour: the dialog header already says nothing here is live,
 * and a greyed-out preview mostly just makes the design hard to read.
 */
function CollaborationPreview() {
  return (
    <div
      inert
      className="mt-3 select-none rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60"
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

/**
 * A sketch of the Devin side of ingestion: a source, what it produced, and the
 * slide it lands on. Drawn here rather than screenshotted, and `inert` so it
 * can't read as a working connector list.
 */
function IngestionPreview() {
  const rows = [
    ['Devin session · Q3 revenue analysis', 'ran 4 queries', 'Revenue by segment'],
    ['Devin session · Churn cohort pull', 'ran 2 queries', 'Retention curve'],
    ['Devin session · Support volume', 'ran 1 query', 'Tickets per week'],
  ];
  return (
    <div
      inert
      className="mt-3 select-none divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-zinc-50 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/60"
    >
      {rows.map(([source, work, slide]) => (
        <div key={source} className="flex items-center gap-3 px-3 py-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-700 dark:text-zinc-200">
            {source}
          </span>
          <span className="shrink-0 text-[11px] text-zinc-400">{work}</span>
          <span aria-hidden className="shrink-0 text-[11px] text-zinc-400">
            &rarr;
          </span>
          <span className="shrink-0 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
            {slide}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The report generation flow, drawn as the four screens it actually is:
 * set it up, pull the numbers, approve, deliver. The `Reports` preview below
 * shows where reports *live*; this shows how one gets *made*, which is the
 * part a list of cards can't say.
 *
 * Sketched here rather than screenshotted — the steps after the first have no
 * real screens yet — and `inert`, so none of it reads as a working wizard.
 */
function FlowStep({
  n,
  title,
  caption,
  children,
}: {
  n: number;
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-semibold text-white">
          {n}
        </span>
        <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">{title}</span>
      </div>
      <p className="mt-1 pl-7 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
        {caption}
      </p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

/** A label / value row, the shape the real report sheet uses for its fields. */
function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-2.5 py-1.5 last:border-b-0 dark:border-zinc-800">
      <span className="shrink-0 text-[11px] text-zinc-400">{label}</span>
      <span className="min-w-0 truncate text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
        {value}
      </span>
    </div>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3 shrink-0 text-emerald-500">
      <path
        d="M3.5 8.5 6.5 11.5 12.5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReportFlowPreview() {
  return (
    <div inert className="mt-3 grid select-none gap-3 sm:grid-cols-2">
      <FlowStep
        n={1}
        title="Set up the report"
        caption="Pick the deck, the cadence and who gets it. The deck stays the source of truth — the report is only the delivery around it."
      >
        <div className="rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
          <FieldRow label="Deck" value="Q3 Business Review" />
          <FieldRow label="Schedule" value="Every Monday at 9:00 AM" />
          <FieldRow label="Format" value="PDF" />
          <FieldRow
            label="Recipients"
            value={
              <span className="flex items-center gap-1">
                <span className="rounded bg-white px-1.5 py-0.5 text-[10px] ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700">
                  exec-staff@
                </span>
                <span className="rounded bg-white px-1.5 py-0.5 text-[10px] ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700">
                  #revenue
                </span>
                <span className="text-[10px] text-zinc-400">+2</span>
              </span>
            }
          />
        </div>
      </FlowStep>

      <FlowStep
        n={2}
        title="The numbers refresh"
        caption="At send time each chart re-runs against its source, and the deck stamps the “as of” a reader needs to trust the figures."
      >
        <div className="space-y-1.5 rounded-md border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
          {[
            ['Revenue by segment', 'Snowflake · 4.2s'],
            ['Pipeline coverage', 'Salesforce · 1.8s'],
            ['Support volume', 'Zendesk · 0.9s'],
          ].map(([chart, source]) => (
            <div key={chart} className="flex items-center gap-2">
              <Check />
              <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-700 dark:text-zinc-200">
                {chart}
              </span>
              <span className="shrink-0 text-[10px] text-zinc-400">{source}</span>
            </div>
          ))}
          <div className="border-t border-zinc-200 pt-1.5 text-[10px] text-zinc-400 dark:border-zinc-800">
            Data as of Mon 8:59 AM · 3 of 3 charts refreshed
          </div>
        </div>
      </FlowStep>

      <FlowStep
        n={3}
        title="Someone approves it"
        caption="Reports that shouldn’t leave unattended wait in an approvals queue, with the built deck attached to look at first."
      >
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-800 dark:text-zinc-100">
              Q3 Business Review · weekly
            </span>
            <span className="shrink-0 text-[10px] text-zinc-500">waiting 4m</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {['Title', 'Revenue', 'Pipeline', 'Risks'].map((slide) => (
              <div
                key={slide}
                className="flex h-9 flex-1 items-center justify-center rounded border border-zinc-200 bg-white text-[9px] text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {slide}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-medium text-white">
              Approve &amp; send
            </span>
            <span className="rounded bg-white px-2 py-1 text-[10px] font-medium text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700">
              Decline
            </span>
            <span className="ml-auto text-[10px] text-zinc-500">Approver · Maria</span>
          </div>
        </div>
      </FlowStep>

      <FlowStep
        n={4}
        title="It goes out"
        caption="One send per channel, logged against the report — so “did the Monday deck go?” has an answer without asking anyone."
      >
        <div className="space-y-1.5 rounded-md border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
          {[
            ['Email', 'exec-staff@company.com', '9:01 AM'],
            ['Slack', '#revenue', '9:01 AM'],
            ['Drive', '/Shared/Reports/Q3', '9:01 AM'],
          ].map(([channel, where, at]) => (
            <div key={channel} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[10px] font-medium text-zinc-500">{channel}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-700 dark:text-zinc-200">
                {where}
              </span>
              <Check />
              <span className="shrink-0 text-[10px] text-zinc-400">{at}</span>
            </div>
          ))}
          <div className="border-t border-zinc-200 pt-1.5 text-[10px] text-zinc-400 dark:border-zinc-800">
            Next run Mon 9:00 AM · skipped if the deck hasn’t changed
          </div>
        </div>
      </FlowStep>
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
            <ReportFlowPreview />
            {/* And where the reports themselves live. This preview moved here
                from the Reports tab; it draws itself `inert`, so nothing in it
                can be clicked. */}
            <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <Reports docs={docs} />
            </div>
          </Section>

          <Section
            id="ingestion"
            title="Direct data ingestion from Devin"
            blurb="Devin does the query and the digging, and the answer arrives in the deck as a chart you can keep editing."
          >
            <Bullets
              items={[
                'Point a deck at a Devin session and pull its results in directly — no copy-paste, no CSV in between.',
                'Devin queries the warehouse, cleans the result and hands back a chart-ready series.',
                'Charts stay live against the source, so re-running the session refreshes the slide.',
                'Every figure keeps a link back to the session and query that produced it.',
              ]}
            />
            <IngestionPreview />
          </Section>
        </div>
      </div>
    </div>
  );
}
