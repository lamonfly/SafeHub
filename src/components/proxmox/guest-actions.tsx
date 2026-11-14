"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
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
const confirmations: Partial<Record<GuestAction, { message: string; danger?: boolean }>> = {
  shutdown: { message: "Asks the guest to shut down cleanly." },
  reboot: { message: "Restarts the guest. Running work is interrupted." },
  stop: { message: "Cuts power immediately, like pulling the plug. Unsaved data can be lost.", danger: true },
};

export function GuestActions({
  guest,
}: {
  guest: Pick<ProxmoxGuest, "node" | "type" | "vmid" | "name" | "status">;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [confirm, dialog] = useConfirm();

  // A paused guest must be resumed (or stopped); Proxmox rejects start.
  const actions: GuestAction[] =
    guest.status === "running"
      ? ["shutdown", "reboot", "stop"]
      : guest.status === "paused"
        ? ["resume", "stop"]
        : ["start"];

  async function run(action: GuestAction) {
    const confirmation = confirmations[action];
    if (confirmation) {
      const confirmed = await confirm({
        title: `${labels[action]} ${guest.name ?? guest.vmid}?`,
        message: confirmation.message,
        confirmLabel: labels[action],
        danger: confirmation.danger,
      });
      if (!confirmed) return;
    }

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
    <div className="flex shrink-0 flex-col gap-1 md:items-end">
      <div
        className="grid gap-2 pl-[22px] md:flex md:pl-0"
        style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}
      >
        {actions.map((action) => (
          <Button
            key={action}
            variant={action === "stop" ? "danger" : action === "start" || action === "resume" ? "tonal" : "outlined"}
            disabled={pending}
            onClick={() => run(action)}
            className="px-1 text-[13px] whitespace-nowrap sm:text-sm md:px-4"
          >
            {labels[action]}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
      {dialog}
    </div>
  );
}
