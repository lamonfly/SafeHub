import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { alert, metricHourly, metricSample } from "@/db/schema";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const RAW_RETENTION_MS = 7 * DAY;
export const HOURLY_RETENTION_MS = 90 * DAY;

// better-sqlite3 binds JS numbers as REAL, so "ts / bucket" would not round
// down on its own: every bucket expression uses CAST(... AS INTEGER).

export function minuteStart(time: number): number {
  return time - (time % MINUTE);
}

export function saveSamples(ts: number, samples: { series: string; value: number }[]): void {
  if (samples.length === 0) return;
  db.insert(metricSample)
    .values(samples.map((sample) => ({ ...sample, ts })))
    .onConflictDoUpdate({
      target: [metricSample.series, metricSample.ts],
      set: { value: sql`excluded.value` },
    })
    .run();
}

// Newest first.
// Only samples from the last `count` minutes before `now` count: older ones
// (taken before a restart, or before a service was removed and added again)
// say nothing about whether a condition is sustained right now.
export function lastValues(series: string, count: number, now: number): number[] {
  return db
    .select({ value: metricSample.value })
    .from(metricSample)
    .where(and(eq(metricSample.series, series), gte(metricSample.ts, minuteStart(now) - count * MINUTE)))
    .orderBy(desc(metricSample.ts))
    .limit(count)
    .all()
    .map((row) => row.value);
}

// Rolls minute samples into hourly average/peak for every complete hour since
// `from`, then deletes data past its retention. Safe to repeat.
export function rollUpAndPrune(from: number, now: number): void {
  const currentHour = now - (now % HOUR);
  db.run(sql`
    INSERT OR REPLACE INTO metric_hourly (series, ts, avg, max)
    SELECT series, CAST(ts / ${HOUR} AS INTEGER) * ${HOUR} AS hour, avg(value), max(value)
    FROM metric_sample
    WHERE ts >= ${from - (from % HOUR)} AND ts < ${currentHour}
    GROUP BY series, hour
  `);
  db.delete(metricSample).where(lt(metricSample.ts, now - RAW_RETENTION_MS)).run();
  db.delete(metricHourly).where(lt(metricHourly.ts, now - HOURLY_RETENTION_MS)).run();
  db.delete(alert)
    .where(and(isNotNull(alert.endedAt), lt(alert.endedAt, new Date(now - HOURLY_RETENTION_MS))))
    .run();
}

export type Point = { ts: number; avg: number; max: number };

const ranges = {
  "24h": { span: DAY, bucket: 5 * MINUTE, table: "raw" },
  "7d": { span: 7 * DAY, bucket: 30 * MINUTE, table: "raw" },
  "30d": { span: 30 * DAY, bucket: HOUR, table: "hourly" },
  "90d": { span: 90 * DAY, bucket: 6 * HOUR, table: "hourly" },
} as const;

export type Range = keyof typeof ranges;
export const rangeNames = Object.keys(ranges) as Range[];

// Points for several series over a range, averaged into buckets so a chart
// gets a few hundred points at most.
export function readSeries(series: string[], range: Range, now = Date.now()): Map<string, Point[]> {
  const result = new Map<string, Point[]>(series.map((name) => [name, []]));
  if (series.length === 0) return result;
  const { span, bucket, table } = ranges[range];
  const since = now - span;

  const rows =
    table === "raw"
      ? db
          .select({
            series: metricSample.series,
            ts: sql<number>`CAST(${metricSample.ts} / ${bucket} AS INTEGER) * ${bucket}`.as("bucket"),
            avg: sql<number>`avg(${metricSample.value})`,
            max: sql<number>`max(${metricSample.value})`,
          })
          .from(metricSample)
          .where(and(inArray(metricSample.series, series), sql`${metricSample.ts} >= ${since}`))
          .groupBy(metricSample.series, sql`bucket`)
          .orderBy(sql`bucket`)
          .all()
      : db
          .select({
            series: metricHourly.series,
            ts: sql<number>`CAST(${metricHourly.ts} / ${bucket} AS INTEGER) * ${bucket}`.as("bucket"),
            avg: sql<number>`avg(${metricHourly.avg})`,
            max: sql<number>`max(${metricHourly.max})`,
          })
          .from(metricHourly)
          .where(and(inArray(metricHourly.series, series), sql`${metricHourly.ts} >= ${since}`))
          .groupBy(metricHourly.series, sql`bucket`)
          .orderBy(sql`bucket`)
          .all();

  for (const row of rows) result.get(row.series)?.push({ ts: row.ts, avg: row.avg, max: row.max });
  return result;
}

// Series names starting with a prefix that have any history (e.g. all
// Synology volumes).
export function knownSeries(prefix: string): string[] {
  const rows = db.all<{ series: string }>(sql`
    SELECT series FROM metric_sample WHERE series LIKE ${`${prefix}%`}
    UNION SELECT series FROM metric_hourly WHERE series LIKE ${`${prefix}%`}
  `);
  return rows.map((row) => row.series).sort();
}

// Last 24 hours in 15-minute steps, for the small trend lines on the cards.
export function readTrends(series: string[]): Map<string, number[]> {
  const bucket = 15 * MINUTE;
  const rows = series.length
    ? db
        .select({
          series: metricSample.series,
          ts: sql<number>`CAST(${metricSample.ts} / ${bucket} AS INTEGER) * ${bucket}`.as("bucket"),
          avg: sql<number>`avg(${metricSample.value})`,
        })
        .from(metricSample)
        .where(and(inArray(metricSample.series, series), sql`${metricSample.ts} >= ${Date.now() - DAY}`))
        .groupBy(metricSample.series, sql`bucket`)
        .orderBy(sql`bucket`)
        .all()
    : [];
  const trends = new Map<string, number[]>(series.map((name) => [name, []]));
  for (const row of rows) trends.get(row.series)?.push(row.avg);
  return trends;
}
