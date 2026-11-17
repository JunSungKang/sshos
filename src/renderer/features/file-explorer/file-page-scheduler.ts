// Serialize aggregate IPC and permit a small burst. Wait only when the shared
// paging budget is empty, leaving capacity for normal window/session actions.
let tail: Promise<unknown> = Promise.resolve();
let tokens = 8;
let updatedAt = performance.now();
export function scheduleFilePage<T>(action: () => Promise<T>): Promise<T> {
  const next = tail.then(async () => {
    const now = performance.now();
    tokens = Math.min(8, tokens + Math.max(0, now - updatedAt) / 100);
    updatedAt = now;
    if (tokens < 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.ceil((1 - tokens) * 100)),
      );
      const resumed = performance.now();
      tokens = Math.min(8, tokens + Math.max(0, resumed - updatedAt) / 100);
      updatedAt = resumed;
    }
    tokens = Math.max(0, tokens - 1);
    return action();
  });
  tail = next.catch(() => {});
  return next;
}
