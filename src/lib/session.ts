import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// The real auth check: reads the session from the database.
// Call it in every protected page, Route Handler and Server Action.
// The proxy check is only an optimistic redirect.
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
