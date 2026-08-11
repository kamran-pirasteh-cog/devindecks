'use client';

/**
 * "Start something new" picker. Three ways in: browse a template, start from a
 * prior document (duplicate it), or start blank. Each path creates + persists a
 * document and opens it in the editor.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TEMPLATES } from '@/templates/registry';
import { createDoc, duplicateDoc, listDocs } from '@/docs/repository';
import { Thumb } from './Thumb';

type Tab = 'templates' | 'docs' | 'blank';

const SLIDE_SIZE = { w: 12_192_000, h: 6_858_000 };

export function NewDocModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('templates');
  const docs = listDocs();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const open = (deckId: string | null) => {
    if (deckId) router.push(`/edit/${deckId}`);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'templates', label: 'Templates' },
    { id: 'docs', label: 'From a document' },
    { id: 'blank', label: 'Blank' },
  ];

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
          <h2 className="text-sm font-semibold">Start something new</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ×
          </button>
        </div>

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
              {TEMPLATES.filter((t) => t.id !== 'blank').map((t) => (
                <button
                  key={t.id}
                  onClick={() => open(createDoc(t.id).id)}
                  className="group overflow-hidden rounded-lg border border-zinc-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                  title={t.description}
                >
                  <div className="border-b border-zinc-100 dark:border-zinc-800 [&>div]:!w-full">
                    <Thumb deck={{ slides: t.buildSlides(), slideSize: SLIDE_SIZE }} />
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
                    onClick={() => open(duplicateDoc(deck.id)?.id ?? null)}
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
                onClick={() => open(createDoc('blank').id)}
                className="rounded-md bg-black px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
              >
                Create blank presentation
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
