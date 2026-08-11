'use client';

/** Template card for Admin: click to open + edit; "..." menu for rename, duplicate, delete. */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DesignSystem } from '@/model';
import { SlideView } from '@/render/SlideView';
import {
  deleteTemplate,
  duplicateTemplate,
  updateTemplateMeta,
  type StoredTemplate,
} from '@/templates/repository';

const SLIDE_SIZE = { w: 12_192_000, h: 6_858_000 };

export function TemplateCard({
  template,
  designSystem,
  onChange,
}: {
  template: StoredTemplate;
  designSystem: DesignSystem;
  onChange: () => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(template.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const commitRename = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== template.name) updateTemplateMeta(template.id, { name: trimmed });
    else setName(template.name);
    setRenaming(false);
    onChange();
  };

  return (
    <div
      onClick={() => !renaming && router.push(`/admin/templates/${template.id}`)}
      className="group relative cursor-pointer overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="border-b border-zinc-100 dark:border-zinc-800 [&>div]:!w-full">
        <SlideView
          slide={template.slides[0]}
          slideSize={SLIDE_SIZE}
          designSystem={designSystem}
          width={320}
        />
      </div>
      <div className="px-3 py-2">
        <div className="flex items-center justify-between gap-1">
          {renaming ? (
            <input
              ref={inputRef}
              value={name}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setName(template.name);
                  setRenaming(false);
                }
              }}
              className="w-full rounded border border-indigo-300 bg-white px-1 py-0.5 text-xs font-medium outline-none dark:bg-zinc-800"
            />
          ) : (
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">{template.name}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                {template.category}
              </div>
            </div>
          )}

          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              title="More"
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 opacity-0 hover:bg-zinc-100 group-hover:opacity-100 dark:hover:bg-zinc-800"
            >
              •••
            </button>

            {menuOpen ? (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-7 z-10 w-40 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
              >
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setRenaming(true);
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
                >
                  Rename
                </button>
                <button
                  onClick={() => {
                    duplicateTemplate(template.id);
                    setMenuOpen(false);
                    onChange();
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
                >
                  Duplicate
                </button>
                <div className="my-1 border-t border-zinc-100 dark:border-zinc-700" />
                <button
                  onClick={() => {
                    deleteTemplate(template.id);
                    setMenuOpen(false);
                    onChange();
                  }}
                  className="block w-full px-3 py-1.5 text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
