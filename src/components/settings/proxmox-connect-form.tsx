"use client";

import { useActionState } from "react";
import { connectProxmoxAction } from "./actions";

const inputClass = "rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm";

// One-time Proxmox setup with an admin login; see lib/integrations/proxmox/connect.ts.
export function ProxmoxConnectForm({ defaultUrl }: { defaultUrl?: string }) {
  const [state, formAction, pending] = useActionState(connectProxmoxAction, {});

  return (
    <details className="rounded-md border border-foreground/10 p-3 text-sm">
      <summary className="cursor-pointer font-medium">Connect with password (creates the token for you)</summary>
      <p className="mt-2 text-foreground/70">
        SafeHub logs in once, creates a user <code>safehub@pve</code> with its own API token and
        read-only rights (plus start/stop if ticked), and saves the token. The password is not stored.
      </p>
      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            Proxmox URL
            <input
              name="url"
              required
              defaultValue={defaultUrl}
              placeholder="https://192.168.1.10:8006"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            Admin user
            <input name="username" required defaultValue="root@pam" autoComplete="username" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            Password
            <input name="password" type="password" autoComplete="current-password" className={inputClass} />
          </label>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="allowControl" defaultChecked />
          Allow start, shut down and reboot from SafeHub
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-foreground px-3 py-1.5 font-medium text-background disabled:opacity-50"
          >
            {pending ? "Connecting…" : "Connect"}
          </button>
          {state.error && (
            <span role="alert" className="text-red-500">
              {state.error}
            </span>
          )}
          {state.message && <span className="text-foreground/70">{state.message}</span>}
        </div>
      </form>
    </details>
  );
}
