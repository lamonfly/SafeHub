"use client";

import { useActionState } from "react";
import { discoverAction, scanPortsAction, type ScanState } from "./actions";

const inputClass = "rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm";
const buttonClass =
  "rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50";

function Feedback({ state }: { state: ScanState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-red-500">
        {state.error}
      </p>
    );
  }
  if (state.message) return <p className="text-sm text-foreground/70">{state.message}</p>;
  return null;
}

export function DiscoveryForm({ subnets }: { subnets: string[] }) {
  const [state, formAction, pending] = useActionState(discoverAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Network range
          <input
            name="cidr"
            required
            list="local-subnets"
            defaultValue={subnets[0] ?? "192.168.1.0/24"}
            className={`${inputClass} w-48 font-mono`}
          />
          <datalist id="local-subnets">
            {subnets.map((subnet) => (
              <option key={subnet} value={subnet} />
            ))}
          </datalist>
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Scanning…" : "Scan network"}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function PortScanForm() {
  const [state, formAction, pending] = useActionState(scanPortsAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          IP address
          <input name="ip" required placeholder="192.168.1.20" className={`${inputClass} w-40 font-mono`} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Ports
          <input
            name="ports"
            placeholder="Top ports, or 22,80,8000-8100"
            className={`${inputClass} w-64 font-mono`}
          />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Scanning…" : "Scan ports"}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

// Row button: scans the top ports of one host.
export function HostPortScanButton({ ip }: { ip: string }) {
  const [state, formAction, pending] = useActionState(scanPortsAction, {});

  return (
    <form action={formAction} className="flex items-center justify-end gap-2">
      <input type="hidden" name="ip" value={ip} />
      {state.error && (
        <span role="alert" className="text-xs text-red-500">
          {state.error}
        </span>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-foreground/20 px-2 py-1 text-xs whitespace-nowrap disabled:opacity-50"
      >
        {pending ? "Scanning…" : "Scan ports"}
      </button>
    </form>
  );
}
