import "server-only";
import { evaluateAlerts } from "@/lib/alerts/rules";
import { notify } from "@/lib/notifications/ntfy";
import { collect } from "./collect";
import { minuteStart, RAW_RETENTION_MS, rollUpAndPrune, saveSamples } from "./store";

// Background job: once a minute, sample everything that is configured, store
// it, and check the alert rules. Runs whether or not anyone has SafeHub
// open. Started once from instrumentation.ts.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// A round that has not finished by then is given up, so one request that
// never settles cannot stop all sampling. Below a minute: the next round
// starts on time.
export const ROUND_TIMEOUT_MS = 50_000;

export type SamplerParts = {
  collect: typeof collect;
  saveSamples: typeof saveSamples;
  evaluateAlerts: typeof evaluateAlerts;
  notify: typeof notify;
  rollUpAndPrune: typeof rollUpAndPrune;
  now: () => number;
  roundTimeoutMs: number;
};

// First hour to roll up after a start: the first one whose minute samples
// are all still kept, so a correct hourly value is never replaced by one
// computed from a partly pruned hour.
export function firstRollUpHour(now: number): number {
  const oldestKept = now - RAW_RETENTION_MS;
  return oldestKept - (oldestKept % HOUR) + HOUR;
}

export function createSampler(overrides: Partial<SamplerParts> = {}) {
  const parts: SamplerParts = {
    collect,
    saveSamples,
    evaluateAlerts,
    notify,
    rollUpAndPrune,
    now: Date.now,
    roundTimeoutMs: ROUND_TIMEOUT_MS,
    ...overrides,
  };
  let running = false;
  let lastRollUp = 0;
  let round = 0;

  // Hourly averages for complete hours, and pruning, once per hour. Separate
  // from the sample round, so a failing or stuck round never stops pruning.
  function rollUpIfDue(now: number) {
    if (now - lastRollUp < HOUR) return;
    try {
      parts.rollUpAndPrune(lastRollUp || firstRollUpHour(now), now);
      lastRollUp = now - (now % HOUR);
    } catch (error) {
      console.warn(`Metrics roll-up failed: ${(error as Error).message}`);
    }
  }

  async function sample(now: number, current: number) {
    const snapshot = await parts.collect();
    // Given up by the watchdog: a later round already took over.
    if (current !== round) return;
    parts.saveSamples(
      minuteStart(now),
      snapshot.readings.map(({ series, value }) => ({ series, value })),
    );
    // Pushes take up to 5 s each: one given up meanwhile stops sending.
    await parts.notify(parts.evaluateAlerts(snapshot, new Date(now)), now, () => current === round);
  }

  async function tick(): Promise<void> {
    const now = parts.now();
    rollUpIfDue(now);
    if (running) return; // a slow round (service timeouts) must not overlap the next
    running = true;
    const current = ++round;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), parts.roundTimeoutMs);
      timer.unref?.();
    });
    try {
      const outcome = await Promise.race([sample(now, current).then(() => "done" as const), timeout]);
      if (outcome === "timeout") {
        round++; // the stuck round must not save or alert when it ends after all
        console.warn(`Metrics sample gave up after ${Math.round(parts.roundTimeoutMs / 1000)} s.`);
      }
    } catch (error) {
      console.warn(`Metrics sample failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
      running = false;
    }
  }

  return { tick };
}

// Guarded on globalThis so dev-mode reloads do not start a second loop.
const globalState = globalThis as typeof globalThis & { safehubSampler?: boolean };

export function startSampler(): void {
  if (globalState.safehubSampler) return;
  globalState.safehubSampler = true;
  const { tick } = createSampler();
  // First sample right away, then on each minute boundary.
  void tick();
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), MINUTE).unref();
  }, MINUTE - (Date.now() % MINUTE) + 2_000).unref();
}
