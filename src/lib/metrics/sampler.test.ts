import { beforeAll, describe, expect, it, vi } from "vitest";
import { migratedDb } from "../../../tests/support/helpers";
import type { Snapshot } from "./collect";

let sampler: typeof import("./sampler");

beforeAll(async () => {
  await migratedDb();
  sampler = await import("./sampler");
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const start = Date.UTC(2026, 10, 14, 10, 30, 0);

const emptySnapshot = (): Snapshot => ({ readings: [{ series: "synology:cpu", value: 5, kind: "cpu", label: "Synology" }], disks: [], reachable: new Set() });

function setup(collect: () => Promise<Snapshot>, roundTimeoutMs = 1_000) {
  let now = start;
  const parts = {
    collect: vi.fn(collect),
    saveSamples: vi.fn(),
    evaluateAlerts: vi.fn(() => []),
    notify: vi.fn(async () => {}),
    rollUpAndPrune: vi.fn(),
    now: () => now,
    roundTimeoutMs,
  };
  const { tick } = sampler.createSampler(parts);
  return { parts, tick, advance: (ms: number) => (now += ms) };
}

describe("sampler", () => {
  it("rolls up from the first fully kept hour after a start, then once per hour", async () => {
    const { parts, tick, advance } = setup(async () => emptySnapshot());
    await tick();
    // 7 days ago is 10:30; 10:00 is partly pruned, so 11:00 is the first hour.
    expect(parts.rollUpAndPrune).toHaveBeenCalledWith(start - 7 * DAY + 30 * MINUTE, start);
    expect(sampler.firstRollUpHour(start)).toBe(start - 7 * DAY + 30 * MINUTE);
    advance(MINUTE);
    await tick();
    expect(parts.rollUpAndPrune).toHaveBeenCalledTimes(1);
    advance(HOUR);
    await tick();
    expect(parts.rollUpAndPrune).toHaveBeenCalledTimes(2);
    // From the hour of the previous roll-up, so nothing is skipped.
    expect(parts.rollUpAndPrune).toHaveBeenLastCalledWith(start - 30 * MINUTE, start + 61 * MINUTE);
    expect(parts.saveSamples).toHaveBeenCalledTimes(3);
  });

  it("keeps rolling up and sampling after a failed round", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let fail = true;
    const { parts, tick, advance } = setup(async () => {
      if (fail) throw new Error("CA file vanished");
      return emptySnapshot();
    });
    await tick();
    expect(parts.saveSamples).not.toHaveBeenCalled();
    expect(parts.rollUpAndPrune).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("CA file vanished"));
    fail = false;
    advance(MINUTE);
    await tick();
    expect(parts.saveSamples).toHaveBeenCalledTimes(1);
    expect(parts.notify).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("runs the roll-up even when it is the alert step that fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { parts, tick } = setup(async () => emptySnapshot());
    parts.evaluateAlerts.mockImplementation(() => {
      throw new Error("database is locked");
    });
    await tick();
    expect(parts.rollUpAndPrune).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("database is locked"));
    warn.mockRestore();
  });

  it("never overlaps rounds, and gives up a round that never ends", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let release: (snapshot: Snapshot) => void = () => {};
    const { parts, tick, advance } = setup(() => new Promise<Snapshot>((resolve) => (release = resolve)), 200);
    const first = tick();
    advance(MINUTE);
    await tick(); // the first round is still running
    expect(parts.collect).toHaveBeenCalledTimes(1);
    await first; // released by the watchdog
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("gave up"));

    parts.collect.mockImplementation(async () => emptySnapshot());
    advance(MINUTE);
    await tick();
    expect(parts.collect).toHaveBeenCalledTimes(2);
    expect(parts.saveSamples).toHaveBeenCalledTimes(1);

    // The stuck round ending late must not save or alert any more.
    release(emptySnapshot());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(parts.saveSamples).toHaveBeenCalledTimes(1);
    expect(parts.evaluateAlerts).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("stops a round given up while it sends notifications", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { parts, tick, advance } = setup(async () => emptySnapshot(), 200);
    let release: () => void = () => {};
    const wanted: boolean[] = [];
    parts.notify.mockImplementationOnce(async (...args: unknown[]) => {
      const stillWanted = args[2] as () => boolean;
      wanted.push(stillWanted());
      await new Promise<void>((resolve) => (release = resolve)); // a push that hangs
      wanted.push(stillWanted());
    });
    await tick(); // given up by the watchdog while notifying
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("gave up"));
    advance(MINUTE);
    await tick(); // the next round sends as usual
    expect(parts.notify).toHaveBeenCalledTimes(2);
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(wanted).toEqual([true, false]);
    warn.mockRestore();
  });
});
