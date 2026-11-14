"use client";

import { useActionState, useTransition, useState } from "react";
import type { FieldType } from "@/lib/settings/definitions";
import { clearGroupAction, saveGroupAction, type SettingsState } from "./actions";

export type FieldState = {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  source?: "env" | "saved";
  // Current value for non-secret fields only; secrets never reach the browser.
  value?: string;
};

const inputClass =
  "rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm disabled:opacity-60";

function Feedback({ state }: { state: SettingsState }) {
  if (state.error) {
    return (
      <span role="alert" className="text-sm text-red-500">
        {state.error}
      </span>
    );
  }
  return state.message ? <span className="text-sm text-foreground/70">{state.message}</span> : null;
}

function Field({ field }: { field: FieldState }) {
  const locked = field.source === "env";
  const lockedNote = locked ? "Set in compose.yaml / .env" : undefined;

  if (field.type === "flag") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name={field.key}
          defaultChecked={field.value === "true"}
          disabled={locked}
        />
        {field.label}
        {lockedNote && <span className="text-xs text-foreground/50">({lockedNote})</span>}
      </label>
    );
  }

  const placeholder =
    field.type === "secret" && field.source
      ? locked
        ? "Set in compose.yaml / .env"
        : "Saved. Leave empty to keep it."
      : field.placeholder;

  return (
    <label className="flex flex-col gap-1 text-sm">
      {field.label}
      <input
        name={field.key}
        type={field.type === "secret" ? "password" : "text"}
        defaultValue={field.type === "secret" ? undefined : field.value}
        placeholder={placeholder}
        disabled={locked}
        autoComplete="off"
        className={inputClass}
      />
      {lockedNote && field.type !== "secret" && <span className="text-xs text-foreground/50">{lockedNote}</span>}
    </label>
  );
}

export function GroupForm({ groupId, fields }: { groupId: string; fields: FieldState[] }) {
  const [state, formAction, pending] = useActionState(saveGroupAction, {});
  const [clearState, setClearState] = useState<SettingsState>({});
  const [clearing, startClear] = useTransition();
  const hasSaved = fields.some((field) => field.source === "saved");

  function clear() {
    if (!window.confirm("Remove the saved settings for this service?")) return;
    startClear(async () => setClearState(await clearGroupAction(groupId)));
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="group" value={groupId} />
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <Field key={field.key} field={field} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {hasSaved && (
          <button
            type="button"
            onClick={clear}
            disabled={clearing}
            className="rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-500 disabled:opacity-50"
          >
            Remove
          </button>
        )}
        <Feedback state={state.error || state.message ? state : clearState} />
      </div>
    </form>
  );
}
