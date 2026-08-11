'use client';

/**
 * Homepage / dashboard: your documents, plus a "Start something new" button that
 * opens the picker (browse templates · start from a prior doc · blank).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type Deck } from '@/model';
import { createDoc, listDocs, seedIfFirstRun } from '@/docs/repository';
import { TEMPLATES } from '@/templates/registry';
import { Thumb } from './Thumb';
import { DocCard } from './DocCard';
import { NewDocModal } from './NewDocModal';

const SLIDE_SIZE = { w: 12_192_000, h: 6_858_000 };
const COLLAPSED_COUNT = 4;

export function Home() {
  const router = useRouter();
  const [docs, setDocs] = useState<Deck[]>([]);
  const [modal, setModal] = useState(false);
  const [showAllTemplates, setShowAllTemplates] = useState(false);

  useEffect(() => {
    seedIfFirstRun();
    setDocs(listDocs());
  }, []);

  const refreshDocs = () => setDocs(listDocs());

  const namedTemplates = TEMPLATES.filter((t) => t.id !== 'blank');
  const visibleTemplates = showAllTemplates
    ? namedTemplates
    : namedTemplates.slice(0, COLLAPSED_COUNT);

  const createFromTemplate = (templateId: string) => {
    const deck = createDoc(templateId);
    router.push(`/edit/${deck.id}`);
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-black text-xs font-bold text-white dark:bg-white dark:text-black">
              D
            </div>
            <span className="text-sm font-semibold tracking-tight">Devin Design</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin"
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Admin
            </Link>
            <button
              onClick={() => setModal(true)}
              className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
            >
              + New
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <section className="mb-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Templates</h2>
            {namedTemplates.length > COLLAPSED_COUNT ? (
              <button
                onClick={() => setShowAllTemplates((v) => !v)}
                className="text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100"
              >
                {showAllTemplates ? 'See less' : 'See more'}
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visibleTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => createFromTemplate(t.id)}
                className="group overflow-hidden rounded-lg border border-zinc-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                title={t.description}
              >
                <div className="overflow-hidden border-b border-zinc-100 dark:border-zinc-800 [&>div]:!w-full">
                  <Thumb deck={{ slides: t.buildSlides(), slideSize: SLIDE_SIZE }} />
                </div>
                <div className="px-3 py-2">
                  <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
                    {t.name}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                    {t.category}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              Your documents
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {docs.map((deck) => (
              <DocCard key={deck.id} deck={deck} onChange={refreshDocs} />
            ))}
          </div>
        </section>
      </main>

      {modal ? <NewDocModal onClose={() => setModal(false)} /> : null}
    </div>
  );
}
