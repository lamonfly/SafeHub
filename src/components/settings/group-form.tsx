"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Checkbox, TextField } from "@/components/ui/text-field";
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

const LOCKED = "Set in compose.yaml / .env";

function Feedback({ state }: { state: SettingsState }) {
  if (state.error) {
    return (
      <span role="alert" className="text-sm text-error">
        {state.error}
      </span>
    );
  }
  return state.message ? <span className="text-sm text-on-surface-variant">{state.message}</span> : null;
}

function Field({ field }: { field: FieldState }) {
  const locked = field.source === "env";

  if (field.type === "flag") {
    return (
      <Checkbox
        name={field.key}
        label={field.label}
        supportingText={locked ? LOCKED : undefined}
        defaultChecked={field.value === "true"}
        disabled={locked}
      />
    );
  }

  const placeholder =
    field.type === "secret" && field.source ? (locked ? LOCKED : "Saved. Leave empty to keep it.") : field.placeholder;

  return (
    <TextField
      label={field.label}
      name={field.key}
      type={field.type === "secret" ? "password" : field.type === "url" ? "url" : "text"}
      inputMode={field.type === "url" ? "url" : field.type === "days" ? "numeric" : undefined}
      defaultValue={field.type === "secret" ? undefined : field.value}
      placeholder={placeholder}
      supportingText={locked && field.type !== "secret" ? LOCKED : undefined}
      disabled={locked}
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
    />
  );
}

export function GroupForm({ groupId, fields }: { groupId: string; fields: FieldState[] }) {
  const [state, formAction, pending] = useActionState(saveGroupAction, {});
  const [clearState, setClearState] = useState<SettingsState>({});
  const [clearing, startClear] = useTransition();
  // Feedback shows the result of whichever action ran last.
  const [lastAction, setLastAction] = useState<"save" | "clear">("save");
  const [confirm, dialog] = useConfirm();
  const hasSaved = fields.some((field) => field.source === "saved");
  const allLocked = fields.every((field) => field.source === "env");

  async function clear() {
    const confirmed = await confirm({
      title: "Remove saved settings?",
      message: "The saved values for this service are deleted. Settings from compose.yaml / .env stay.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    setLastAction("clear");
    startClear(async () => setClearState(await clearGroupAction(groupId)));
  }

  return (
    <form action={formAction} onSubmit={() => setLastAction("save")} className="flex flex-col gap-4">
      <input type="hidden" name="group" value={groupId} />
      <div className="grid gap-x-4 gap-y-5 pt-2 sm:grid-cols-2">
        {fields.map((field) => (
          <Field key={field.key} field={field} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!allLocked && (
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        )}
        {hasSaved && (
          <Button variant="danger" onClick={clear} disabled={clearing}>
            Remove
          </Button>
        )}
        <Feedback state={lastAction === "clear" ? clearState : state} />
      </div>
      {dialog}
    </form>
  );
}
