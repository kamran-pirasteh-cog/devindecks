'use client';

/**
 * "New template" picker, in two steps — the Admin twin of `NewDocModal`.
 *
 * Step 1 asks WHERE it goes, step 2 asks WHAT it starts from. That order is the
 * opposite of the document flow's (which browses first, then asks the details)
 * and it's deliberate: a template nobody can find is a template nobody starts a
 * deck from, so filing is the decision that can't be skipped. The folder step is
 * also where a folder gets created, so "somewhere new" doesn't mean backing out
 * to the rail and starting over.
 *
 * The three sources mirror the new-deck flow, so the two read as one gesture:
 *
 *  - UPLOAD parses a .pptx or .pdf and offers the same import-as-is / convert-to-
 *    brand choice a document upload gets, via the very same panel.
 *  - DUPLICATE copies an existing template, or promotes a document someone
 *    already made ("this deck is how we do these").
 *  - FROM SCRATCH opens the template editor on one empty slide.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Deck } from '@/model';
import {
  createTemplate,
  createTemplateFromDeck,
  duplicateTemplate,
  updateTemplateMeta,
  type StoredTemplate,
} from '@/templates/repository';
import {
  createTemplateFolder,
  isTemplateFolderNameAvailable,
  suggestTemplateFolderName,
  type TemplateFolder,
} from '@/templates/folders';
import { UploadDeckPanel } from '@/home/UploadDeckPanel';
import { Thumb } from '@/home/Thumb';
import { useToast } from '@/ui/Toast';

type Tab = 'upload' | 'duplicate' | 'scratch';

const SLIDE_SIZE = { w: 12_192_000, h: 6_858_000 };

/**
 * Which folder step 1 settled on. `null` is Unfiled — an explicit choice here,
 * not an absent one, so "I'll file it later" is something you can say out loud
 * rather than something you do by dodging the step.
 */
type Destination = { folderId: string | null; label: string };

export function NewTemplateModal({
  folders,
  /** The rail's current folder, if any — the destination that's already implied. */
  initialFolderId,
  onClose,
  /** Something was created; the shelf and the rail counts need re-reading. */
  onCreated,
  templates,
  docs,
}: {
  folders: TemplateFolder[];
  initialFolderId?: string;
  onClose: () => void;
  onCreated: () => void;
  templates: StoredTemplate[];
  docs: Deck[];
}) {
  const router = useRouter();
  const toast = useToast();

  // Opening from inside a folder skips step 1: the rail already said where, and
  // asking again would be asking the user to repeat themselves. Resolved in the
  // initializer rather than an effect — the modal mounts when "New template" is
  // clicked, so the rail's folder is already known at first render and an effect
  // would only render the step-1 screen for a frame before replacing it.
  const [destination, setDestination] = useState<Destination | null>(() => {
    const folder = initialFolderId ? folders.find((f) => f.id === initialFolderId) : null;
    return folder ? { folderId: folder.id, label: folder.name } : null;
  });
  const [tab, setTab] = useState<Tab>('upload');
  // The inline "new folder" field on step 1. `null` means it isn't open.
  const [newFolderName, setNewFolderName] = useState<string | null>(null);

  // Escape backs out of step 2 rather than closing outright — the same rule
  // `NewDocModal` follows, so a stray keypress costs one step, not the flow.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // Never straight back to a step the folder rail already answered.
      if (destination && !initialFolderId) setDestination(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [destination, initialFolderId, onClose]);

  /** Every path ends here: file it, say so, and open it in the editor. */
  const finish = (template: StoredTemplate, what: string) => {
    onCreated();
    toast(destination?.folderId ? `${what} in “${destination.label}”.` : `${what}.`);
    router.push(`/admin/templates/${template.id}`);
  };

  const folderId = destination?.folderId ?? undefined;

  const commitNewFolder = () => {
    const name = (newFolderName ?? '').trim();
    if (!name || !isTemplateFolderNameAvailable(name)) {
      setNewFolderName(null);
      return;
    }
    const folder = createTemplateFolder(name);
    // The rail behind the modal has to learn about the folder now, not when the
    // template lands — otherwise cancelling out of step 2 loses it.
    onCreated();
    setNewFolderName(null);
    setDestination({ folderId: folder.id, label: folder.name });
  };

  const fromScratch = () => {
    const t = createTemplate({
      name: 'Untitled template',
      category: 'Blank',
      folderId,
    });
    finish(t, `Created “${t.name}”`);
  };

  const fromTemplate = (src: StoredTemplate) => {
    const copy = duplicateTemplate(src.id);
    if (!copy) return;
    // `duplicateTemplate` clones the source's filing along with everything else,
    // so the folder chosen here has to be applied over the top.
    if (copy.folderId !== folderId) updateTemplateMeta(copy.id, { folderId });
    finish(copy, `Created “${copy.name}” from “${src.name}”`);
  };

  const fromDoc = (deck: Deck) => {
    const t = createTemplateFromDeck(deck, {
      category: 'Blank',
      folderId,
      description: `Started from the “${deck.title}” document.`,
    });
    finish(t, `“${t.name}” is now a template`);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'upload', label: 'Upload' },
    { id: 'duplicate', label: 'Duplicate' },
    { id: 'scratch', label: 'From scratch' },
  ];

  const cardClass =
    'group overflow-hidden rounded-lg border border-zinc-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900';

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
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">
              {destination ? 'What does it start from?' : 'Where does it go?'}
            </h2>
            {destination ? (
              <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                Filing under {destination.label}
              </p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ×
          </button>
        </div>

        {!destination ? (
          <div className="overflow-y-auto p-5">
            <p className="text-xs text-zinc-500">
              Folders are how everyone else finds this — the new-document picker
              groups the templates it offers by them.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setDestination({ folderId: f.id, label: f.name })}
                  className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-700 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-500/10"
                >
                  {f.name}
                </button>
              ))}

              {newFolderName === null ? (
                <button
                  onClick={() => setNewFolderName(suggestTemplateFolderName())}
                  className="rounded-md border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 dark:border-zinc-600 dark:hover:text-zinc-100"
                >
                  + New folder
                </button>
              ) : (
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onBlur={commitNewFolder}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitNewFolder();
                    if (e.key === 'Escape') {
                      // Swallowed, so the modal-level handler doesn't take this
                      // as "close the whole flow".
                      e.stopPropagation();
                      setNewFolderName(null);
                    }
                  }}
                  placeholder="Folder name…"
                  className="w-40 rounded-md border border-indigo-300 bg-white px-2 py-2 text-xs outline-none dark:bg-zinc-800"
                />
              )}
            </div>

            <button
              onClick={() => setDestination({ folderId: null, label: 'Unfiled' })}
              className="mt-5 text-[11px] text-zinc-400 hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
            >
              Skip — leave it unfiled
            </button>
          </div>
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
              {tab === 'upload' ? (
                <UploadDeckPanel
                  onReady={({ slides, suggestedTitle, converted }) => {
                    // The slides arrive already parsed and (if asked) converted,
                    // so this is a plain create rather than another trip through
                    // the importer.
                    const t = createTemplate({
                      name: suggestedTitle || 'Untitled template',
                      category: 'Blank',
                      folderId,
                      slides,
                      description: converted
                        ? `Uploaded from ${suggestedTitle}, converted to the brand.`
                        : `Uploaded from ${suggestedTitle}, imported as-is.`,
                    });
                    finish(
                      t,
                      `Created “${t.name}”` +
                        (converted ? ', converted to the brand' : ', imported as-is'),
                    );
                  }}
                />
              ) : null}

              {tab === 'duplicate' ? (
                <div className="space-y-6">
                  <section>
                    <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                      Existing templates
                    </h3>
                    {templates.length === 0 ? (
                      <p className="text-xs text-zinc-400">No templates to copy yet.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                        {templates.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => fromTemplate(t)}
                            title={`Duplicate “${t.name}”`}
                            className={cardClass}
                          >
                            <div className="border-b border-zinc-100 dark:border-zinc-800 [&>div]:!w-full">
                              <Thumb deck={{ slides: t.slides, slideSize: SLIDE_SIZE }} />
                            </div>
                            <div className="px-3 py-2">
                              <div className="truncate text-xs font-medium">{t.name}</div>
                              <div className="mt-0.5 text-[10px] text-zinc-400">
                                {t.slides.length} slide{t.slides.length === 1 ? '' : 's'}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* The old toolbar's "From a document", moved in here: promoting
                      a deck is a way of starting a template, not a separate mode. */}
                  <section>
                    <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                      Promote a document
                    </h3>
                    {docs.length === 0 ? (
                      <p className="text-xs text-zinc-400">There are no documents to promote yet.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                        {docs.map((deck) => (
                          <button
                            key={deck.id}
                            onClick={() => fromDoc(deck)}
                            title={`Make a template from “${deck.title}”`}
                            className={cardClass}
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
                    )}
                  </section>
                </div>
              ) : null}

              {tab === 'scratch' ? (
                <div className="flex flex-col items-center justify-center gap-4 py-12">
                  <div className="aspect-video w-64 rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800" />
                  <button
                    onClick={fromScratch}
                    className="rounded-md bg-black px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
                  >
                    Start with one empty slide
                  </button>
                </div>
              ) : null}
            </div>

            {/* Only offered when step 1 was actually asked — see the Escape rule. */}
            {initialFolderId ? null : (
              <div className="border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
                <button
                  onClick={() => setDestination(null)}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  ← Back
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
