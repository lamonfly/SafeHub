"use client";

import { useActionState } from "react";
import type { FormState } from "./actions";

type Field = {
  name: string;
  label: string;
  type: "text" | "password";
  autoComplete: string;
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
    <form action={formAction} className="flex flex-col gap-4">
      {fields.map((field) => (
        <label key={field.name} className="flex flex-col gap-1 text-sm">
          {field.label}
          <input
            name={field.name}
            type={field.type}
            autoComplete={field.autoComplete}
            required={field.required ?? true}
            className="rounded-md border border-foreground/20 bg-transparent px-3 py-2"
          />
        </label>
      ))}
      {state.error && (
        <p role="alert" className="text-sm text-red-500">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-foreground px-3 py-2 font-medium text-background disabled:opacity-50"
      >
        {pending ? "Please wait…" : submitLabel}
      </button>
    </form>
  );
}
