"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { muteAlertAction } from "./actions";

const options = [
  { duration: "1h", label: "1 hour" },
  { duration: "8h", label: "8 hours" },
  { duration: "24h", label: "24 hours" },
  { duration: "resolved", label: "Until resolved" },
] as const;

// "Mute" button of an open alert on /alerts: an M3 dialog asks for how long.
// Muting silences notifications only; the alert stays listed.
export function AlertMute({ id, title, muted }: { id: number; title: string; muted: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function run(duration: (typeof options)[number]["duration"] | "off") {
    setError(undefined);
    startTransition(async () => {
      const result = await muteAlertAction({ id, duration });
      setError(result.error);
      if (!result.error) dialogRef.current?.close();
    });
  }

  return (
    <>
      {muted ? (
        <Button variant="text" className="-ml-3 self-start" disabled={pending} onClick={() => run("off")}>
          Unmute
        </Button>
      ) : (
        <Button variant="text" className="-ml-3 self-start" disabled={pending} onClick={() => dialogRef.current?.showModal()}>
          Mute
        </Button>
      )}
      {muted && error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClick={(event) => {
          // Tap on the backdrop closes, as in M3.
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto w-[calc(100%-48px)] max-w-md rounded-[28px] bg-surface-container-high p-6 text-on-surface shadow-elevation-3"
      >
        <div className="flex flex-col gap-4">
          <h2 id={titleId} className="text-2xl leading-8">
            Mute notifications
          </h2>
          <p className="text-sm text-on-surface-variant">
            No notifications for &ldquo;{title}&rdquo;, not even when it gets worse or is resolved. It stays on this
            page.
          </p>
          <ul className="flex flex-col">
            {options.map((option) => (
              <li key={option.duration}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(option.duration)}
                  className="flex min-h-12 w-full items-center rounded-full px-4 text-left text-base text-on-surface hover:bg-on-surface/8 disabled:opacity-40"
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="text" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
