import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// History for charts and alerts (see lib/metrics). A series is a name like
// "synology:cpu" or "guest:pve/101:ram"; values are percentages, or 1/0 for
// up/down series.

// One value per series per minute, kept 7 days.
export const metricSample = sqliteTable(
  "metric_sample",
  {
    series: text("series").notNull(),
    ts: integer("ts").notNull(), // ms, start of the minute
    value: real("value").notNull(),
  },
  (table) => [primaryKey({ columns: [table.series, table.ts] }), index("metric_sample_ts_idx").on(table.ts)],
);

// Hourly average and peak, kept 90 days.
export const metricHourly = sqliteTable(
  "metric_hourly",
  {
    series: text("series").notNull(),
    ts: integer("ts").notNull(), // ms, start of the hour
    avg: real("avg").notNull(),
    max: real("max").notNull(),
  },
  (table) => [primaryKey({ columns: [table.series, table.ts] }), index("metric_hourly_ts_idx").on(table.ts)],
);

// A problem from start to end. Open while endedAt is null; unread while
// readAt is null. Kept 90 days.
export const alert = sqliteTable(
  "alert",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull(), // rule + subject, e.g. "cpu:synology"
    severity: text("severity", { enum: ["warning", "critical"] }).notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    unit: text("unit").notNull().default("%"), // for peak; "" for up/down
    peak: real("peak"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    // Notifications for this alert are muted until then; it is still
    // recorded and listed. ALERT_MUTED_UNTIL_RESOLVED: until it closes.
    mutedUntil: integer("muted_until", { mode: "timestamp_ms" }),
  },
  (table) => [index("alert_key_idx").on(table.key), index("alert_started_idx").on(table.startedAt)],
);

export type Alert = typeof alert.$inferSelect;

// Far future: an alert muted "until resolved" (a new alert for the same
// problem is a new row and notifies again).
export const ALERT_MUTED_UNTIL_RESOLVED = new Date(Date.UTC(9999, 0, 1));

// Planned maintenance: no notifications at all until "until". At most one
// row (id 1); removed when cancelled.
export const notificationPause = sqliteTable("notification_pause", {
  id: integer("id").primaryKey(),
  until: integer("until", { mode: "timestamp_ms" }).notNull(),
});
