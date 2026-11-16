import "server-only";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { alert, ALERT_MUTED_UNTIL_RESOLVED, notificationPause, type Alert } from "@/db/schema";

// Open alerts first (critical before warning), then the rest newest first.
export function listAlerts(limit = 200): Alert[] {
  return db
    .select()
    .from(alert)
    .orderBy(
      sql`${alert.endedAt} IS NOT NULL`,
      // Severity only ranks open alerts; resolved ones are purely by time.
      sql`CASE WHEN ${alert.endedAt} IS NULL AND ${alert.severity} = 'critical' THEN 0 ELSE 1 END`,
      desc(alert.startedAt),
    )
    .limit(limit)
    .all();
}

export function openAlerts(): Alert[] {
  return db
    .select()
    .from(alert)
    .where(isNull(alert.endedAt))
    .orderBy(sql`CASE ${alert.severity} WHEN 'critical' THEN 0 ELSE 1 END`, desc(alert.startedAt))
    .all();
}

export function unreadCount(): number {
  return db.select({ value: count() }).from(alert).where(isNull(alert.readAt)).get()?.value ?? 0;
}

export function markAllRead(): void {
  db.update(alert).set({ readAt: new Date() }).where(isNull(alert.readAt)).run();
}

const HOUR = 3_600_000;

// Muting an open alert silences its notifications (also an escalation and
// its "resolved" push) for a while; the alert itself is still recorded.
export const muteDurations = { "1h": HOUR, "8h": 8 * HOUR, "24h": 24 * HOUR, resolved: null } as const;
export type MuteDuration = keyof typeof muteDurations;

// Returns false when the alert is not open (any more).
export function muteAlert(id: number, duration: MuteDuration | "off", now = Date.now()): boolean {
  const length = duration === "off" ? 0 : muteDurations[duration];
  const until = duration === "off" ? null : length === null ? ALERT_MUTED_UNTIL_RESOLVED : new Date(now + length);
  const result = db
    .update(alert)
    .set({ mutedUntil: until })
    .where(and(eq(alert.id, id), isNull(alert.endedAt)))
    .run();
  return result.changes > 0;
}

export function isMuted(mutedUntil: Date | null, now = Date.now()): boolean {
  return mutedUntil !== null && mutedUntil.getTime() > now;
}

export function isMutedUntilResolved(mutedUntil: Date | null): boolean {
  return mutedUntil !== null && mutedUntil.getTime() >= ALERT_MUTED_UNTIL_RESOLVED.getTime();
}

// Maintenance: no notifications at all for a while.
export const pauseDurations = { "1h": HOUR, "4h": 4 * HOUR, "24h": 24 * HOUR } as const;
export type PauseDuration = keyof typeof pauseDurations;

export function pauseNotifications(duration: PauseDuration | "off", now = Date.now()): void {
  if (duration === "off") {
    db.delete(notificationPause).run();
    return;
  }
  const until = new Date(now + pauseDurations[duration]);
  db.insert(notificationPause)
    .values({ id: 1, until })
    .onConflictDoUpdate({ target: notificationPause.id, set: { until } })
    .run();
}

// End of the current pause, or null when notifications are on.
export function notificationsPausedUntil(now = Date.now()): Date | null {
  const row = db.select().from(notificationPause).where(eq(notificationPause.id, 1)).get();
  return row && row.until.getTime() > now ? row.until : null;
}
