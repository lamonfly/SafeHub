"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox, TextField } from "@/components/ui/text-field";
import { connectProxmoxAction } from "./actions";

// One-time Proxmox setup with an admin login; see lib/integrations/proxmox/connect.ts.
export function ProxmoxConnectForm({ defaultUrl }: { defaultUrl?: string }) {
  const [state, formAction, pending] = useActionState(connectProxmoxAction, {});

  return (
    <details className="group rounded-xl border border-outline-variant [--field-bg:var(--md-surface-container-low)]">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-medium text-primary">
        Connect with password (creates the token for you)
        <span aria-hidden className="transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <p className="text-sm text-on-surface-variant">
          SafeHub logs in once, creates a user <code>safehub@pve</code> with its own API token and read-only
          rights (plus start/stop if ticked), and saves the token. The password is not stored.
        </p>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid gap-x-4 gap-y-5 pt-2 md:grid-cols-3">
            <TextField
              label="Proxmox URL"
              name="url"
              required
              type="url"
              inputMode="url"
              defaultValue={defaultUrl}
              placeholder="https://192.168.1.10:8006"
              autoCapitalize="none"
              autoCorrect="off"
            />
            <TextField
              label="Admin user"
              name="username"
              required
              defaultValue="root@pam"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
            />
            <TextField label="Password" name="password" type="password" autoComplete="current-password" />
          </div>
          <Checkbox name="allowControl" label="Allow start, shut down and reboot from SafeHub" defaultChecked />
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Connecting…" : "Connect"}
            </Button>
          </div>
          {state.error && <Banner tone="error">{state.error}</Banner>}
          {state.message && <Banner tone="info">{state.message}</Banner>}
        </form>
      </div>
    </details>
  );
}
