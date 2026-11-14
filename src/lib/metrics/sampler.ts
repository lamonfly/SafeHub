import "server-only";
import { evaluateAlerts } from "@/lib/alerts/rules";
import { collect } from "./collect";
import { minuteStart, RAW_RETENTION_MS, rollUpAndPrune, saveSamples } from "./store";

// Background job: once a minute, sample everything that is configured, store
// it, and check the alert rules. Runs whether or not anyone has SafeHub
// open. Started once from instrumentation.ts.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let running = false;
let lastRollUp = 0;

async function tick(): Promise<void> {
  if (running) return; // a slow round (service timeouts) must not overlap the next
  running = true;
  try {
    const now = Date.now();
    const snapshot = await collect();
    saveSamples(
      minuteStart(now),
      snapshot.readings.map(({ series, value }) => ({ series, value })),
    );
    evaluateAlerts(snapshot, new Date(now));

    // Hourly averages for complete hours, and pruning, once per hour.
    if (now - lastRollUp >= HOUR) {
      rollUpAndPrune(lastRollUp || now - RAW_RETENTION_MS, now);
      lastRollUp = now - (now % HOUR);
    }
  } catch (error) {
    console.warn(`Metrics sample failed: ${(error as Error).message}`);
  } finally {
    running = false;
  }
}

// Guarded on globalThis so dev-mode reloads do not start a second loop.
const globalState = globalThis as typeof globalThis & { safehubSampler?: boolean };

export function startSampler(): void {
  if (globalState.safehubSampler) return;
  globalState.safehubSampler = true;
  // First sample right away, then on each minute boundary.
  void tick();
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), MINUTE).unref();
  }, MINUTE - (Date.now() % MINUTE) + 2_000).unref();
}
