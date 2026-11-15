"use client";

import { useState, useTransition } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { testNotificationAction, type SettingsState } from "./actions";

// Settings > Notifications: checks the saved ntfy settings end to end.
export function NotificationTest({ configured }: { configured: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SettingsState>({});

  return (
    <div className="flex flex-col gap-3 border-t border-outline-variant pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="tonal"
          disabled={pending || !configured}
          onClick={() => startTransition(async () => setState(await testNotificationAction()))}
        >
          {pending ? "Sending…" : "Send test notification"}
        </Button>
        {!configured && <span className="text-sm text-on-surface-variant">Save a topic first.</span>}
      </div>
      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.message && <Banner tone="info">{state.message}</Banner>}
    </div>
  );
}
