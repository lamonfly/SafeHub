"use client";

import { useState, useTransition } from "react";
import type { GuestAction, ProxmoxGuest } from "@/lib/integrations/proxmox/schemas";
import { proxmoxGuestAction } from "./actions";

const labels: Record<GuestAction, string> = {
  start: "Start",
  shutdown: "Shut down",
  reboot: "Reboot",
  stop: "Force stop",
  resume: "Resume",
};

// Start and resume are harmless; everything else interrupts a guest.
const confirmations: Partial<Record<GuestAction, string>> = {
  shutdown: "Shut down",
  reboot: "Reboot",
  stop: "Force stop (like pulling the power cord)",
};

export function GuestActions({
  guest,
}: {
  guest: Pick<ProxmoxGuest, "node" | "type" | "vmid" | "name" | "status">;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  // A paused guest must be resumed (or stopped); Proxmox rejects start.
  const actions: GuestAction[] =
    guest.status === "running"
      ? ["shutdown", "reboot", "stop"]
      : guest.status === "paused"
        ? ["resume", "stop"]
        : ["start"];

  function run(action: GuestAction) {
    const question = confirmations[action];
    const label = guest.name ?? guest.vmid;
    if (question && !window.confirm(`${question} ${label}?`)) return;

    setError(undefined);
    startTransition(async () => {
      const result = await proxmoxGuestAction({
        node: guest.node,
        type: guest.type,
        vmid: guest.vmid,
        action,
      });
      setError(result.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          disabled={pending}
          onClick={() => run(action)}
          className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
            action === "stop"
              ? "border-red-500/40 text-red-500"
              : "border-foreground/20"
          }`}
        >
          {labels[action]}
        </button>
      ))}
      {error && (
        <p role="alert" className="w-full text-right text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
