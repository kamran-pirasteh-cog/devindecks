'use client';

/**
 * "Start something new" picker, in two steps.
 *
 * Step 1 picks where the slides come from: browse a template, start from a
 * prior document (duplicate it), or start blank. Step 2 asks the four questions
 * worth answering while the deck is still empty — what to call it, who it's
 * for, when the meeting is, and who's presenting — then creates + persists the
 * document and opens it in the editor.
 *
 * The questions come second on purpose: picking a template is the browsing
 * half, and putting a form in front of it makes every path feel like paperwork.
 * Every field is optional; Create works with the defaults untouched.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  addDocTag,
  createDoc,
  duplicateDoc,
  isTitleAvailable,
  listDocs,
  setDocBrief,
  setDocFolder,
  suggestCopyTitle,
} from '@/docs/repository';
import { getFolder } from '@/docs/folders';
import { useToast } from '@/ui/Toast';
import { listTemplates, seedIfFirstRun, type StoredTemplate } from '@/templates/repository';
import { Thumb } from './Thumb';

type Tab = 'templates' | 'docs' | 'blank';

const SLIDE_SIZE = { w: 12_192_000, h: 6_858_000 };

/**
 * What step 1 chose. `defaultTitle` is the name the repository would have given
 * this document on its own, so the name field starts pre-filled and Create with
 * an untouched form behaves exactly as the one-step flow did.
 */
type Source =
  | { kind: 'template'; id: string; label: string; defaultTitle: string }
  | { kind: 'doc'; id: string; label: string; defaultTitle: string }
  | { kind: 'blank'; label: string; defaultTitle: string };

/**
 * `base`, or `base (2)`, `base (3)`… — the first name nothing else is using.
 *
 * Template names collide constantly: the reference decks are *named* after the
 * templates they came from, so "Wayfair Reskin" is already taken on a fresh
 * dashboard. Without this the details step opens with its own default flagged
 * as a duplicate and Create disabled, which reads as a bug.
 */
function uniqueTitle(base: string): string {
  if (isTitleAvailable(base)) return base;
  let n = 2;
  while (!isTitleAvailable(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

/** Today as `YYYY-MM-DD` in the viewer's own timezone, for `<input type="date">`. */
function todayISO(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function NewDocModal({
  onClose,
  /** Folder the dashboard was showing, if any — the new document lands there. */
  folderId,
}: {
  onClose: () => void;
  folderId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('templates');
  const [templates, setTemplates] = useState<StoredTemplate[]>([]);
  const docs = listDocs();

  /** Unset while browsing; set means we're on the details step. */
  const [source, setSource] = useState<Source | null>(null);
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [meetingDate, setMeetingDate] = useState(todayISO());
  const [attendees, setAttendees] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    seedIfFirstRun();
    setTemplates(listTemplates());
  }, []);

  // Escape backs out of the details step rather than closing: the answers are
  // typed there, and losing all four to a stray keypress is the worse outcome.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (source) setSource(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, source]);

  // The pre-filled name is the field most likely to be replaced outright, so
  // it arrives selected rather than just focused.
  useEffect(() => {
    if (source) titleRef.current?.select();
  }, [source]);

  // Every path in here funnels through `open`, so filing once here covers
  // templates, duplicates and blank alike: create something while a folder is
  // selected and it stays in that folder instead of landing in Unfiled.
  // `what` names what was just made ("Created “X”"); the folder, if there is
  // one, is appended here so all three paths say where it landed. The toast
  // outlives this modal, and the dashboard behind it, because the provider sits
  // in the root layout — so the confirmation is read in the editor we're about
  // to land in, which is where the user actually is when it appears.
  const open = (deckId: string | null, what: string) => {
    if (!deckId) return;
    if (folderId) setDocFolder(deckId, folderId);
    const folder = folderId ? getFolder(folderId) : null;
    toast(folder ? `${what} in “${folder.name}”.` : `${what}.`);
    router.push(`/edit/${deckId}`);
  };

  /** Step 1 → step 2. The details form owns document creation from here. */
  const choose = (next: Source) => {
    setSource(next);
    setTitle(next.defaultTitle);
  };

  const trimmedTitle = title.trim();
  const titleTaken = trimmedTitle.length > 0 && !isTitleAvailable(trimmedTitle);
  const canCreate = trimmedTitle.length > 0 && !titleTaken;

  const create = () => {
    if (!source || !canCreate) return;
    const deck =
      source.kind === 'doc'
        ? duplicateDoc(source.id, trimmedTitle)
        : createDoc(source.kind === 'template' ? source.id : 'blank', trimmedTitle);
    if (!deck) return;
    // `setDocBrief` does the trimming and drops whatever came back empty, so
    // the raw field values — and a comma-split that may be all empties — are
    // safe to hand over as they are.
    setDocBrief(deck.id, { client, meetingDate, attendees: attendees.split(',') });
    // The client is also written out as a tag: tags are what the dashboard
    // filters and searches on, so answering "who is this for?" here files the
    // deck under that client without a second trip through the ••• menu.
    if (client.trim()) addDocTag(deck.id, client);
    open(
      deck.id,
      source.kind === 'doc'
        ? `Duplicated “${source.label}” as “${deck.title}”`
        : source.kind === 'template'
          ? `Created “${deck.title}” from the ${source.label} template`
          : `Created “${deck.title}”`,
    );
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'templates', label: 'Templates' },
    { id: 'docs', label: 'Duplicate existing presentation' },
    { id: 'blank', label: 'Blank slate' },
  ];

  const fieldClass =
    'mt-1 w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-indigo-300 dark:border-zinc-600 dark:bg-zinc-900';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">
            {source ? 'A few details' : 'Start something new'}
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ×
          </button>
        </div>

        {source ? (
          <form
            className="overflow-y-auto p-5"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <p className="text-xs text-zinc-500">
              {source.kind === 'doc'
                ? `Starting from “${source.label}”.`
                : source.kind === 'template'
                  ? `Starting from the ${source.label} template.`
                  : 'Starting from a blank presentation.'}
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium">Name this presentation</span>
                <input
                  ref={titleRef}
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Q3 business review"
                  className={`${fieldClass} ${
                    titleTaken ? '!border-red-300 focus:!border-red-400' : ''
                  }`}
                />
                <span className="mt-1 block text-[10px] text-red-500">
                  {titleTaken ? 'A document already has that name.' : ' '}
                </span>
              </label>

              <label className="block">
                <span className="text-xs font-medium">Which client is it for?</span>
                <input
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                  placeholder="Wayfair"
                  className={fieldClass}
                />
                <span className="mt-1 block text-[10px] text-zinc-400">
                  Also added as a tag, so the deck files under this client.
                </span>
              </label>

              <label className="block">
                <span className="text-xs font-medium">Date of meeting</span>
                <input
                  type="date"
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                  className={fieldClass}
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium">Attending from Cognition</span>
                <input
                  value={attendees}
                  onChange={(e) => setAttendees(e.target.value)}
                  placeholder="Ada Lovelace, Alan Turing"
                  className={fieldClass}
                />
                <span className="mt-1 block text-[10px] text-zinc-400">
                  Separate names with commas.
                </span>
              </label>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setSource(null)}
                className="rounded-md px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                ← Back
              </button>
              <button
                type="submit"
                disabled={!canCreate}
                className="rounded-md bg-black px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-black"
              >
                Create presentation
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex gap-1 border-b border-zinc-200 px-4 dark:border-zinc-800">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium ${
                    tab === t.id
                      ? 'border-indigo-500 text-zinc-900 dark:text-white'
                      : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto p-5">
              {tab === 'templates' ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() =>
                        choose({
                          kind: 'template',
                          id: t.id,
                          label: t.name,
                          // `createDoc`'s own default naming, made unique.
                          defaultTitle: uniqueTitle(
                            t.name === 'Blank' ? 'Untitled presentation' : t.name,
                          ),
                        })
                      }
                      className="group overflow-hidden rounded-lg border border-zinc-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                      title={t.description}
                    >
                      <div className="border-b border-zinc-100 dark:border-zinc-800 [&>div]:!w-full">
                        <Thumb deck={{ slides: t.slides, slideSize: SLIDE_SIZE }} />
                      </div>
                      <div className="px-3 py-2">
                        <div className="truncate text-xs font-medium">{t.name}</div>
                        <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                          {t.category}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}

              {tab === 'docs' ? (
                docs.length === 0 ? (
                  <div className="py-12 text-center text-sm text-zinc-400">
                    No documents to start from yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    {docs.map((deck) => (
                      <button
                        key={deck.id}
                        onClick={() =>
                          choose({
                            kind: 'doc',
                            id: deck.id,
                            label: deck.title,
                            defaultTitle: suggestCopyTitle(deck.title),
                          })
                        }
                        className="group overflow-hidden rounded-lg border border-zinc-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                        title={`Duplicate "${deck.title}"`}
                      >
                        <div className="border-b border-zinc-100 dark:border-zinc-800 [&>div]:!w-full">
                          <Thumb deck={deck} />
                        </div>
                        <div className="px-3 py-2">
                          <div className="truncate text-xs font-medium">{deck.title}</div>
                          <div className="mt-0.5 text-[10px] text-zinc-400">
                            {deck.slides.length} slide{deck.slides.length === 1 ? '' : 's'}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )
              ) : null}

              {tab === 'blank' ? (
                <div className="flex flex-col items-center justify-center gap-4 py-12">
                  <div className="aspect-video w-64 rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800" />
                  <button
                    onClick={() =>
                      choose({
                        kind: 'blank',
                        label: 'Blank',
                        defaultTitle: uniqueTitle('Untitled presentation'),
                      })
                    }
                    className="rounded-md bg-black px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
                  >
                    Continue with a blank presentation
                  </button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
