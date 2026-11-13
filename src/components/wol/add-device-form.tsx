"use client";

import { useActionState, type InputHTMLAttributes } from "react";
import { addDeviceAction } from "./actions";

const inputClass = "rounded-md border border-foreground/20 bg-transparent px-3 py-2";

function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input className={inputClass} {...input} />
      {hint && <span className="text-xs text-foreground/50">{hint}</span>}
    </label>
  );
}

export function AddDeviceForm({
  defaults = {},
}: {
  defaults?: { name?: string; mac?: string; host?: string };
}) {
  const [state, formAction, pending] = useActionState(addDeviceAction, {});

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" name="name" required placeholder="Proxmox mini PC" defaultValue={defaults.name} />
      <Field
        label="MAC address"
        name="mac"
        required
        placeholder="aa:bb:cc:dd:ee:ff"
        defaultValue={defaults.mac}
      />
      <Field
        label="Broadcast address"
        name="broadcast"
        defaultValue="255.255.255.255"
        hint="Or your subnet broadcast, e.g. 192.168.1.255"
      />
      <Field label="WoL port" name="port" type="number" defaultValue={9} min={1} max={65535} />
      <Field
        label="Host (optional)"
        name="host"
        placeholder="192.168.1.20"
        defaultValue={defaults.host}
        hint="IP or hostname, used to show online/offline"
      />
      <Field
        label="Check port (optional)"
        name="checkPort"
        type="number"
        placeholder="22"
        min={1}
        max={65535}
        hint="Any port works if the host refuses it; defaults to 22"
      />
      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add device"}
        </button>
        {state.error && (
          <p role="alert" className="text-sm text-red-500">
            {state.error}
          </p>
        )}
        {state.message && <p className="text-sm text-foreground/70">{state.message}</p>}
      </div>
    </form>
  );
}
