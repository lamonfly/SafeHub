"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import type { FormState } from "./actions";

type Field = {
  name: string;
  label: string;
  type: "text" | "password";
  autoComplete: string;
  supportingText?: string;
  // Defaults to true. Passwords may be empty, so they pass false.
  required?: boolean;
};

export function AuthForm({
  action,
  fields,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  fields: Field[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {fields.map((field) => (
        <TextField
          key={field.name}
          label={field.label}
          supportingText={field.supportingText}
          name={field.name}
          type={field.type}
          autoComplete={field.autoComplete}
          required={field.required ?? true}
          // Phones: no auto-capitalised or autocorrected usernames.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      ))}
      {state.error && <Banner tone="error">{state.error}</Banner>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Please wait…" : submitLabel}
      </Button>
    </form>
  );
}
