import "server-only";

// In-memory failure counter: after `maxFailures` within `windowMs`, the key is
// blocked until the window ends. Single-process only, which fits one container.
export function createFailureLimiter({ maxFailures, windowMs }: { maxFailures: number; windowMs: number }) {
  const entries = new Map<string, { failures: number; resetAt: number }>();

  function current(key: string) {
    const entry = entries.get(key);
    if (entry && Date.now() >= entry.resetAt) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    // Milliseconds until the key may try again; 0 when not blocked.
    retryAfterMs(key: string): number {
      const entry = current(key);
      return entry && entry.failures >= maxFailures ? entry.resetAt - Date.now() : 0;
    },
    recordFailure(key: string): void {
      const entry = current(key);
      if (entry) {
        entry.failures++;
        return;
      }
      // Drop expired keys so random inputs cannot grow the map forever.
      if (entries.size > 10_000) for (const k of entries.keys()) current(k);
      entries.set(key, { failures: 1, resetAt: Date.now() + windowMs });
    },
    // Takes back one recorded failure (an attempt counted up front that
    // turned out to succeed).
    refund(key: string): void {
      const entry = current(key);
      if (entry && entry.failures > 0) entry.failures--;
    },
    reset(key: string): void {
      entries.delete(key);
    },
  };
}
