import "server-only";

// Caches a call's promise for `ttlMs`, so parallel callers (several open
// tabs, overlapping refreshes) share one request. Failures are not cached.
// One cache per wrapped function: arguments are ignored, so only wrap calls
// that always target the same thing.
export function cacheFor<Args extends unknown[], T>(
  ttlMs: number,
  fn: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<T> {
  let cached: { at: number; promise: Promise<T> } | undefined;
  return (...args) => {
    if (!cached || Date.now() - cached.at > ttlMs) {
      const promise = fn(...args);
      cached = { at: Date.now(), promise };
      promise.catch(() => {
        if (cached?.promise === promise) cached = undefined;
      });
    }
    return cached.promise;
  };
}
