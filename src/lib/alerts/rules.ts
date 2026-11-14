import "server-only";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { alert, type Alert } from "@/db/schema";
import type { Snapshot, Source } from "@/lib/metrics/collect";
import { lastValues } from "@/lib/metrics/store";

// Built-in alert rules, checked after every sample. Each rule opens an alert
// when its condition holds and closes it once the value is clearly back to
// normal (the gap between open and close stops flickering).
export const thresholds = {
  usage: { open: 90, close: 85, minutes: 5 }, // CPU / RAM, sustained
  volume: { warning: 85, critical: 95, close: 83 },
};

type Severity = Alert["severity"];
type Verdict =
  | { state: "open"; severity: Severity; title: string; message: string; value?: number; unit: string }
  | { state: "close" }
  | { state: "keep" }; // in between: an open alert stays open, none is opened

const round = (value: number) => Math.round(value);

function usageVerdict(seriesName: string, value: number, title: string): Verdict {
  const { open, close, minutes } = thresholds.usage;
  const recent = lastValues(seriesName, minutes);
  if (recent.length === minutes && recent.every((sample) => sample >= open)) {
    return { state: "open", severity: "warning", title, message: `Above ${open}% for ${minutes} minutes.`, value, unit: "%" };
  }
  return value < close ? { state: "close" } : { state: "keep" };
}

export function evaluateAlerts(snapshot: Snapshot, now: Date): void {
  const open = new Map(
    db.select().from(alert).where(isNull(alert.endedAt)).all().map((row) => [row.key, row] as const),
  );
  const seen = new Set<string>();

  function apply(key: string, verdict: Verdict) {
    seen.add(key);
    const existing = open.get(key);
    if (verdict.state === "close") {
      if (existing) db.update(alert).set({ endedAt: now }).where(eq(alert.id, existing.id)).run();
      return;
    }
    if (verdict.state === "keep") return;
    if (!existing) {
      db.insert(alert)
        .values({
          key,
          severity: verdict.severity,
          title: verdict.title,
          message: verdict.message,
          unit: verdict.unit,
          peak: verdict.value,
          startedAt: now,
        })
        .run();
      return;
    }
    // Still a problem: keep the peak, escalate to critical, refresh the text.
    // An escalation counts as news, so it shows as unread again.
    const escalated = existing.severity === "warning" && verdict.severity === "critical";
    db.update(alert)
      .set({
        severity: escalated ? "critical" : existing.severity,
        message: verdict.message,
        title: verdict.title,
        peak: verdict.value === undefined ? existing.peak : Math.max(existing.peak ?? verdict.value, verdict.value),
        ...(escalated ? { readAt: null } : {}),
      })
      .where(eq(alert.id, existing.id))
      .run();
  }

  for (const reading of snapshot.readings) {
    const { series: name, value, label } = reading;
    if (reading.kind === "cpu") apply(name, usageVerdict(name, value, `${label}: CPU high`));
    if (reading.kind === "ram") apply(name, usageVerdict(name, value, `${label}: memory high`));
    if (reading.kind === "volume") {
      const { warning, critical, close } = thresholds.volume;
      apply(
        name,
        value >= warning
          ? {
              state: "open",
              severity: value >= critical ? "critical" : "warning",
              title: `${label}: almost full`,
              message: `${round(value)}% used.`,
              value,
              unit: "%",
            }
          : value < close
            ? { state: "close" }
            : { state: "keep" },
      );
    }
    if (reading.kind === "up") {
      const grace = reading.graceMinutes ?? 3;
      const recent = lastValues(name, grace);
      const down = recent.length === grace && recent.every((sample) => sample === 0);
      apply(
        name,
        down
          ? { state: "open", severity: "critical", title: `${label}: unreachable`, message: `No answer for ${grace}+ minutes.`, unit: "" }
          : value === 1
            ? { state: "close" }
            : { state: "keep" },
      );
    }
  }

  for (const disk of snapshot.disks) {
    apply(
      disk.key,
      disk.status === "normal"
        ? { state: "close" }
        : {
            state: "open",
            severity: "critical",
            title: `${disk.label}: ${disk.status}`,
            message: "Check the disk in DSM > Storage Manager.",
            unit: "",
          },
    );
  }

  // Alerts whose subject disappeared while its system answered (a guest was
  // stopped, a volume removed) are over. If the system itself is down its
  // "unreachable" alert covers it, so leave the rest open.
  for (const [key, existing] of open) {
    if (seen.has(key)) continue;
    const source: Source | undefined = key.startsWith("synology:") || key.startsWith("disk:synology:")
      ? "synology"
      : key.startsWith("node:") || key.startsWith("guest:")
        ? "proxmox"
        : undefined;
    if (source && snapshot.reachable.has(source)) {
      db.update(alert).set({ endedAt: now }).where(eq(alert.id, existing.id)).run();
    }
  }
}
