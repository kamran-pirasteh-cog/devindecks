import { describe, expect, it, vi } from 'vitest';
import { defineCollection } from './collection';
import { memoryAdapter, type StoreAdapter } from './store';

type Row = { id: string; n: number };

/** A sync-incapable adapter — what a remote store looks like from here. */
const asyncOnly = (seed: Record<string, string> = {}): StoreAdapter => {
  const inner = memoryAdapter(seed);
  return { load: inner.load, save: inner.save };
};

describe('defineCollection', () => {
  it('serves reads synchronously from a sync-capable adapter', () => {
    const c = defineCollection<Row>('k', memoryAdapter({ k: '{"a":{"id":"a","n":1}}' }));
    // No await anywhere: this is the property the ~50 existing call sites need.
    expect(c.snapshot().a.n).toBe(1);
  });

  it('reads empty rather than blocking when the adapter cannot answer synchronously', async () => {
    const c = defineCollection<Row>('k', asyncOnly({ k: '{"a":{"id":"a","n":1}}' }));
    expect(c.snapshot()).toEqual({});
    await c.hydrate();
    expect(c.snapshot().a.n).toBe(1);
  });

  it('hydrates once however many callers ask', async () => {
    const inner = memoryAdapter({ k: '{}' });
    const load = vi.fn(inner.load);
    const c = defineCollection<Row>('k', { load, save: inner.save });

    await Promise.all([c.hydrate(), c.hydrate(), c.hydrate()]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(c.isHydrated()).toBe(true);
  });

  it('applies a mutation to the snapshot on the same tick', () => {
    const c = defineCollection<Row>('k', memoryAdapter());
    c.mutate((m) => {
      m.a = { id: 'a', n: 1 };
    });
    expect(c.snapshot().a.n).toBe(1);
  });

  it('flushes the mutation to the adapter behind it', async () => {
    const adapter = memoryAdapter();
    const c = defineCollection<Row>('k', adapter);

    c.mutate((m) => {
      m.a = { id: 'a', n: 1 };
    });
    await c.flushed();

    expect(JSON.parse((await adapter.load('k'))!)).toEqual({ a: { id: 'a', n: 1 } });
  });

  it('leaves the snapshot untouched when a mutation throws midway', () => {
    const c = defineCollection<Row>('k', memoryAdapter({ k: '{"a":{"id":"a","n":1}}' }));
    expect(() =>
      c.mutate((m) => {
        m.b = { id: 'b', n: 2 };
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(c.snapshot()).toEqual({ a: { id: 'a', n: 1 } });
  });

  it('lands overlapping writes in order', async () => {
    const seen: string[] = [];
    const adapter: StoreAdapter = {
      load: async () => null,
      // The first save is slow. Without a chain it would land last and win.
      save: async (_k, v) => {
        const n = JSON.parse(v).a.n as number;
        await new Promise((r) => setTimeout(r, n === 1 ? 20 : 0));
        seen.push(v);
      },
    };
    const c = defineCollection<Row>('k', adapter);

    c.mutate((m) => {
      m.a = { id: 'a', n: 1 };
    });
    c.mutate((m) => {
      m.a = { id: 'a', n: 2 };
    });
    await c.flushed();

    expect(seen.map((v) => JSON.parse(v).a.n)).toEqual([1, 2]);
  });

  it('reports a failed flush instead of losing it', async () => {
    const onFlushError = vi.fn();
    const c = defineCollection<Row>(
      'k',
      { load: async () => null, save: async () => { throw new Error('quota'); } },
      { onFlushError },
    );

    c.mutate((m) => {
      m.a = { id: 'a', n: 1 };
    });
    await c.flushed();

    expect(onFlushError).toHaveBeenCalledOnce();
    expect((onFlushError.mock.calls[0][0] as Error).message).toBe('quota');
  });

  it('notifies subscribers on mutation and on hydration', async () => {
    const c = defineCollection<Row>('k', asyncOnly({ k: '{}' }));
    const listener = vi.fn();
    c.subscribe(listener);

    await c.hydrate();
    expect(listener).toHaveBeenCalledTimes(1);

    c.mutate((m) => {
      m.a = { id: 'a', n: 1 };
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops notifying after unsubscribe', () => {
    const c = defineCollection<Row>('k', memoryAdapter());
    const listener = vi.fn();
    c.subscribe(listener)();
    c.mutate((m) => {
      m.a = { id: 'a', n: 1 };
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it('runs migrate over loaded contents before anything reads them', () => {
    const c = defineCollection<Row>('k', memoryAdapter({ k: '{"a":{"id":"a"}}' }), {
      migrate: (m) => {
        for (const row of Object.values(m)) if (typeof row.n !== 'number') row.n = 1;
        return m;
      },
    });
    expect(c.snapshot().a.n).toBe(1);
  });

  it('reads corrupt storage as empty rather than throwing', () => {
    const c = defineCollection<Row>('k', memoryAdapter({ k: 'not json' }));
    expect(c.snapshot()).toEqual({});
  });
});
