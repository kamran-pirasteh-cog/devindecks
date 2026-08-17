/**
 * Hand the thread back mid-import, so a long file paints its progress and the
 * window never goes unresponsive.
 *
 * Deliberately NOT `setTimeout(0)`: a background or hidden tab clamps timers to
 * one second, which turned a 500-slide parse from two seconds into minutes. A
 * MessageChannel round trip is a real macrotask boundary — the browser gets to
 * paint and handle input — with no clamp. `scheduler.yield()` is the same idea
 * with priority, and is used where it exists.
 */
export function breathe(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield().catch(() => undefined);

  if (typeof MessageChannel === 'function') {
    return new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(0);
    });
  }

  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * A yield that only costs anything when it's needed: work in a tight loop until
 * `everyMs` has gone by, then breathe. Keeps short files as fast as they were
 * while long ones stay responsive.
 */
export function makePacer(everyMs = 50): () => Promise<void> {
  let last = performance.now();
  return async () => {
    const now = performance.now();
    if (now - last < everyMs) return;
    last = now;
    await breathe();
  };
}
