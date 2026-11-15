"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { serviceAction } from "./actions";

type Action = { id: string; label: string; confirm?: string };

// Buttons on a service tile (scan, refresh, search) with the result below.
export function ServiceActions({ serviceKey, serviceName, actions }: { serviceKey: string; serviceName: string; actions: Action[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; message?: string }>({});
  const [confirm, dialog] = useConfirm();

  async function run(action: Action) {
    if (action.confirm) {
      const confirmed = await confirm({
        title: `${action.label} in ${serviceName}?`,
        message: action.confirm,
        confirmLabel: action.label,
      });
      if (!confirmed) return;
    }
    setResult({});
    startTransition(async () => setResult(await serviceAction(serviceKey, action.id)));
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button key={action.id} variant="outlined" disabled={pending} onClick={() => run(action)} className="px-4">
            {action.label}
          </Button>
        ))}
      </div>
      {result.error && (
        <p role="alert" className="text-xs break-words text-error">
          {result.error}
        </p>
      )}
      {result.message && (
        <p role="status" className="text-xs text-on-surface-variant">
          {result.message}
        </p>
      )}
      {dialog}
    </div>
  );
}
