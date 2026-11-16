import type { Alert } from "@/db/schema";
import { LocalTime } from "@/components/ui/local-time";
import { isMuted, isMutedUntilResolved } from "@/lib/alerts/store";
import { formatDuration } from "@/lib/format";
import { AlertMute } from "./alert-mute";

const severityStyles = {
  critical: { chip: "bg-error-container text-on-error-container", dot: "bg-error", label: "Critical" },
  warning: { chip: "bg-warning-container text-on-warning-container", dot: "bg-warning", label: "Warning" },
} as const;

// M3 list of alerts: open ones show how long they have lasted, closed ones
// when they started and how long they lasted. Unread alerts are emphasised.
// muteControls: open alerts get a Mute / Unmute button (on /alerts).
export function AlertList({ alerts, now, muteControls = false }: { alerts: Alert[]; now: number; muteControls?: boolean }) {
  return (
    <ul className="flex flex-col">
      {alerts.map((item) => {
        const style = severityStyles[item.severity];
        const started = item.startedAt.getTime();
        const ended = item.endedAt?.getTime();
        const unread = item.readAt === null;
        const muted = !ended && isMuted(item.mutedUntil, now);
        return (
          <li key={item.id} className="flex gap-3 border-b border-outline-variant py-3 last:border-b-0">
            <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${ended ? "bg-outline" : style.dot}`} aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-base ${unread ? "font-medium text-on-surface" : "text-on-surface-variant"}`}>
                  {item.title}
                </span>
                <span className={`rounded px-1.5 text-[11px] leading-4 font-medium ${ended ? "bg-surface-container-highest text-on-surface-variant" : style.chip}`}>
                  {ended ? "Resolved" : style.label}
                </span>
              </div>
              <p className="text-sm text-on-surface-variant">
                {item.message}
                {item.peak !== null && item.unit && ` Peak ${Math.round(item.peak)}${item.unit}.`}
              </p>
              <p className="text-xs text-on-surface-variant">
                <LocalTime value={started} />
                {ended
                  ? ` · lasted ${formatDuration(ended - started)}`
                  : ` · ongoing for ${formatDuration(now - started)}`}
                {muted && item.mutedUntil && (
                  <>
                    {" · "}
                    {isMutedUntilResolved(item.mutedUntil) ? (
                      "muted until resolved"
                    ) : (
                      <>
                        muted until <LocalTime value={item.mutedUntil.getTime()} />
                      </>
                    )}
                  </>
                )}
              </p>
              {muteControls && !ended && <AlertMute id={item.id} title={item.title} muted={muted} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
