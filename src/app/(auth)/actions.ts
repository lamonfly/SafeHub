"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import { auth, createFirstAdmin, placeholderEmail, toStoredPassword } from "@/lib/auth";

export type FormState = { error?: string };

// Passwords have no rules (empty allowed); see toStoredPassword.
const passwordSchema = z.string().max(1000, "Password must be at most 1000 characters.");

const credentialsSchema = z.object({
  username: z.string().trim().min(1),
  password: passwordSchema,
});

// Mirrors the username plugin's rules so the form shows a clear message.
const setupSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters.")
    .max(30, "Username must be at most 30 characters.")
    .regex(/^[a-zA-Z0-9_.]+$/, "Username may only contain letters, digits, _ and ."),
  password: passwordSchema,
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
  if (!parsed.success) return { error: "Enter your username." };

  try {
    const { username, password } = parsed.data;
    await auth.api.signInUsername({
      body: { username, password: toStoredPassword(password) },
      headers: await headers(),
    });
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

  const { username, password } = parsed.data;
  const requestHeaders = await headers();
  try {
    // The sign-up hook in lib/auth.ts refuses this once a user exists;
    // createFirstAdmin serializes calls so that check cannot race.
    await createFirstAdmin(() =>
      auth.api.signUpEmail({
        body: {
          name: username,
          username,
          email: placeholderEmail(username),
          password: toStoredPassword(password),
        },
        headers: requestHeaders,
      }),
    );
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect("/");
}

export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
