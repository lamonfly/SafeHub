"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { pauseNotificationsAction } from "./actions";

const durations = [
  { duration: "1h", label: "1 hour" },
  { duration: "4h", label: "4 hours" },
  { duration: "24h", label: "24 hours" },
] as const;

// /alerts: pause every notification during planned maintenance. Alerts are
// still recorded; changes during the pause are not sent afterwards.
export function NotificationPause({ pausedUntil }: { pausedUntil: number | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function run(duration: (typeof durations)[number]["duration"] | "off") {
    setError(undefined);
    startTransition(async () => setError((await pauseNotificationsAction({ duration })).error));
  }

  return (
    <div className="flex flex-col gap-3">
      {pausedUntil ? (
        <>
          <p className="text-sm text-on-surface">
            Notifications are paused until <LocalTime value={pausedUntil} />.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="tonal" disabled={pending} onClick={() => run("off")}>
              Resume now
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-on-surface-variant">
            Planned work? Pause all notifications for a while. Alerts are still recorded here.
          </p>
          <div className="flex flex-wrap gap-2">
            {durations.map((option) => (
              <Button key={option.duration} variant="outlined" disabled={pending} onClick={() => run(option.duration)}>
                {option.label}
              </Button>
            ))}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
