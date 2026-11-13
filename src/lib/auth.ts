import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { count } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";

export async function hasAnyUser(): Promise<boolean> {
  const [row] = await db.select({ value: count() }).from(schema.user);
  return row.value > 0;
}

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
  },
  telemetry: { enabled: false },
  hooks: {
    // Sign-up is only open for the first-run setup. Once an admin exists,
    // new accounts are refused.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email" && (await hasAnyUser())) {
        throw new APIError("FORBIDDEN", {
          message: "Sign-up is closed.",
        });
      }
    }),
  },
  // Must be last so it can set cookies from Server Actions.
  plugins: [nextCookies()],
});
