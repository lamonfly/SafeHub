import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "../../../tests/support/helpers";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let store: typeof import("./store");
let db: Awaited<ReturnType<typeof migratedDb>>;
let schema: typeof import("@/db/schema");

beforeAll(async () => {
  db = await migratedDb();
  store = await import("./store");
  schema = await import("@/db/schema");

  // Three complete hours of minute samples: 0..59 in every hour.
  const now = Date.now();
  const start = now - (now % HOUR) - 3 * HOUR;
  db.insert(schema.metricSample)
    .values(Array.from({ length: 180 }, (_, index) => ({ series: "node:pve:cpu", ts: start + index * MINUTE, value: index % 60 })))
    .run();
  store.rollUpAndPrune(start, now);
});

describe("history", () => {
  // better-sqlite3 binds JS numbers as REAL; without CAST these buckets
  // would not group at all.
  it("rolls minutes up into hourly average and peak", () => {
    const hourly = db.select().from(schema.metricHourly).all();
    expect(hourly).toHaveLength(3);
    expect(hourly.every((row) => row.avg === 29.5 && row.max === 59)).toBe(true);
  });

  it("averages ranges into buckets", () => {
    const day = store.readSeries(["node:pve:cpu"], "24h").get("node:pve:cpu")!;
    expect(day).toHaveLength(36);
    expect(day.every((point) => point.ts % (5 * MINUTE) === 0)).toBe(true);
    expect(store.readSeries(["node:pve:cpu"], "30d").get("node:pve:cpu")).toHaveLength(3);
    expect(store.readTrends(["node:pve:cpu"]).get("node:pve:cpu")).toHaveLength(12);
  });

  it("keeps a missing series as an empty list", () => {
    expect(store.readSeries(["nothing:here"], "24h").get("nothing:here")).toEqual([]);
  });
});
