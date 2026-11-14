import "server-only";
import { count, desc, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { alert, type Alert } from "@/db/schema";

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
