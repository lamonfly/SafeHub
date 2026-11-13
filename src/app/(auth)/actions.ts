"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import { auth } from "@/lib/auth";

export type FormState = { error?: string };

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const setupSchema = credentialsSchema.extend({
  name: z.string().trim().min(1),
  password: z.string().min(12, "Password must be at least 12 characters."),
});

function errorMessage(error: unknown): string {
  if (isAPIError(error)) return error.message;
  throw error;
}

export async function signIn(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = credentialsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid email and password." };

  try {
    await auth.api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect("/");
}

export async function createAdmin(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = setupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    // The sign-up hook in lib/auth.ts refuses this once a user exists.
    await auth.api.signUpEmail({ body: parsed.data, headers: await headers() });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect("/");
}

export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
