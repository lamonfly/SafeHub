"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { seerrRequestAction } from "./actions";

// Approve / Decline for one pending Seerr request. Declining asks first:
// the person who asked gets told it was declined.
export function SeerrRequestButtons({ id, title }: { id: number; title: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [confirm, dialog] = useConfirm();

  async function decide(decision: "approve" | "decline") {
    if (decision === "decline") {
      const confirmed = await confirm({
        title: `Decline ${title}?`,
        message: "The request is closed and the person who asked is told it was declined.",
        confirmLabel: "Decline",
        danger: true,
      });
      if (!confirmed) return;
    }
    setError(undefined);
    startTransition(async () => setError((await seerrRequestAction({ id, decision })).error));
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <Button variant="tonal" disabled={pending} onClick={() => decide("approve")} className="px-4">
          Approve
        </Button>
        <Button variant="danger" disabled={pending} onClick={() => decide("decline")} className="px-4">
          Decline
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs break-words text-error">
          {error}
        </p>
      )}
      {dialog}
    </div>
  );
}
