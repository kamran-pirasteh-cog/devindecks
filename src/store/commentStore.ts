'use client';

/**
 * Comment command layer, mirroring `editorStore` but deliberately separate.
 *
 * Comments are not deck state (see `comments/types.ts`), so they get their own
 * store and their own persistence. The practical payoff: undo/redo — which
 * snapshots the whole deck — can never resurrect a deleted comment or wipe a
 * new one, and posting a comment doesn't push a history step the user then has
 * to undo twice.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { nanoid } from 'nanoid';
import { getThreads, saveThreads } from '@/comments/repository';
import { DEFAULT_OWNER } from '@/docs/repository';
import type { CommentEntry, CommentThread } from '@/comments/types';

/** Stand-in for the signed-in user, same one the documents repository uses. */
export const COMMENT_AUTHOR = DEFAULT_OWNER;

/** Where new threads land while they're being written. */
export interface CommentDraft {
  slideId: string;
  elementId?: string;
}

interface CommentState {
  /** Null for the sample deck / template editing — comments stay in memory. */
  docId: string | null;
  threads: CommentThread[];

  panelOpen: boolean;
  showResolved: boolean;
  /** 'slide' lists this slide's threads; 'deck' lists the whole document's. */
  scope: 'slide' | 'deck';
  /** Highlighted thread — the pin that's open, and the card scrolled to. */
  activeThreadId: string | null;
  draft: CommentDraft | null;

  load: (docId: string | null) => void;

  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setShowResolved: (v: boolean) => void;
  setScope: (scope: 'slide' | 'deck') => void;
  setActiveThread: (id: string | null) => void;

  /** Begin a thread on an object (or the slide, when `elementId` is undefined). */
  startDraft: (slideId: string, elementId?: string) => void;
  cancelDraft: () => void;
  /** Post the draft. No-op on empty text, so Enter on a blank box does nothing. */
  submitDraft: (body: string) => void;

  reply: (threadId: string, body: string) => void;
  editComment: (threadId: string, commentId: string, body: string) => void;
  deleteComment: (threadId: string, commentId: string) => void;
  setResolved: (threadId: string, resolved: boolean) => void;
  deleteThread: (threadId: string) => void;
}

const now = () => new Date().toISOString();

const entry = (body: string): CommentEntry => ({
  id: `cm-${nanoid(8)}`,
  author: COMMENT_AUTHOR,
  body,
  createdAt: now(),
});

export const useComments = create<CommentState>()(
  immer((set, get) => {
    /** Write-through: every mutation ends here, so nothing can go unsaved. */
    const persist = () => {
      const { docId, threads } = get();
      if (docId) saveThreads(docId, threads);
    };

    return {
      docId: null,
      threads: [],
      panelOpen: false,
      showResolved: false,
      scope: 'slide',
      activeThreadId: null,
      draft: null,

      load(docId) {
        set((s) => {
          s.docId = docId;
          s.threads = docId ? getThreads(docId) : [];
          s.activeThreadId = null;
          s.draft = null;
        });
      },

      openPanel() {
        set((s) => {
          s.panelOpen = true;
        });
      },
      closePanel() {
        set((s) => {
          s.panelOpen = false;
          s.draft = null;
          s.activeThreadId = null;
        });
      },
      togglePanel() {
        if (get().panelOpen) get().closePanel();
        else get().openPanel();
      },

      setShowResolved(v) {
        set((s) => {
          s.showResolved = v;
        });
      },
      setScope(scope) {
        set((s) => {
          s.scope = scope;
        });
      },
      setActiveThread(id) {
        set((s) => {
          s.activeThreadId = id;
          if (id) s.draft = null;
        });
      },

      startDraft(slideId, elementId) {
        set((s) => {
          s.draft = { slideId, elementId };
          s.panelOpen = true;
          s.activeThreadId = null;
        });
      },
      cancelDraft() {
        set((s) => {
          s.draft = null;
        });
      },

      submitDraft(body) {
        const text = body.trim();
        const draft = get().draft;
        if (!text || !draft) return;
        const thread: CommentThread = {
          id: `ct-${nanoid(8)}`,
          slideId: draft.slideId,
          elementId: draft.elementId,
          resolved: false,
          createdAt: now(),
          comments: [entry(text)],
        };
        set((s) => {
          s.threads.push(thread);
          s.draft = null;
          s.activeThreadId = thread.id;
        });
        persist();
      },

      reply(threadId, body) {
        const text = body.trim();
        if (!text) return;
        set((s) => {
          const t = s.threads.find((x) => x.id === threadId);
          if (!t) return;
          t.comments.push(entry(text));
          // Replying to a resolved thread reopens it, as in Google Slides —
          // there's new discussion, so it isn't settled any more.
          t.resolved = false;
          s.activeThreadId = threadId;
        });
        persist();
      },

      editComment(threadId, commentId, body) {
        const text = body.trim();
        if (!text) return;
        set((s) => {
          const c = s.threads
            .find((x) => x.id === threadId)
            ?.comments.find((x) => x.id === commentId);
          if (!c || c.body === text) return;
          c.body = text;
          c.editedAt = now();
        });
        persist();
      },

      /** Deleting the opening comment deletes the thread — its replies have no home. */
      deleteComment(threadId, commentId) {
        set((s) => {
          const i = s.threads.findIndex((x) => x.id === threadId);
          if (i < 0) return;
          const t = s.threads[i];
          if (t.comments[0]?.id === commentId) {
            s.threads.splice(i, 1);
            if (s.activeThreadId === threadId) s.activeThreadId = null;
            return;
          }
          t.comments = t.comments.filter((c) => c.id !== commentId);
        });
        persist();
      },

      setResolved(threadId, resolved) {
        set((s) => {
          const t = s.threads.find((x) => x.id === threadId);
          if (!t) return;
          t.resolved = resolved;
          // A resolved thread drops out of the default view, so keeping it
          // "active" would leave a highlight pointing at nothing.
          if (resolved && s.activeThreadId === threadId) s.activeThreadId = null;
        });
        persist();
      },

      deleteThread(threadId) {
        set((s) => {
          s.threads = s.threads.filter((t) => t.id !== threadId);
          if (s.activeThreadId === threadId) s.activeThreadId = null;
        });
        persist();
      },
    };
  }),
);
