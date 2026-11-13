"use client";

import { useState, useTransition } from "react";
import { deleteDeviceAction, wakeDeviceAction, type ActionState } from "./actions";

function useDeviceAction() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>({});

  function run(action: () => Promise<ActionState>) {
    setState({});
    startTransition(async () => setState(await action()));
  }

  return { pending, state, run };
}

function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <span role="alert" className="text-xs text-red-500">
        {state.error}
      </span>
    );
  }
  if (state.message) {
    return <span className="text-xs text-foreground/60">{state.message}</span>;
  }
  return null;
}

// Waking is harmless (an already-on machine ignores it), so no confirmation.
export function WakeButton({ id }: { id: string }) {
  const { pending, state, run } = useDeviceAction();

  return (
    <span className="flex items-center justify-end gap-2">
      <Feedback state={state} />
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => wakeDeviceAction(id))}
        className="rounded-md border border-foreground/20 px-2 py-1 text-xs disabled:opacity-50"
      >
        {pending ? "Sending…" : "Wake"}
      </button>
    </span>
  );
}

export function DeleteDeviceButton({ id, name }: { id: string; name: string }) {
  const { pending, state, run } = useDeviceAction();

  return (
    <span className="flex items-center justify-end gap-2">
      <Feedback state={state} />
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Remove ${name}?`)) run(() => deleteDeviceAction(id));
        }}
        className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-500 disabled:opacity-50"
      >
        Remove
      </button>
    </span>
  );
}
