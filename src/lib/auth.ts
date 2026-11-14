import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { count } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import { createFailureLimiter } from "@/lib/rate-limit";

export async function hasAnyUser(): Promise<boolean> {
  const [row] = await db.select({ value: count() }).from(schema.user);
  return row.value > 0;
}

// SafeHub logs in by username only. better-auth core still requires a unique
// email per user, so accounts get this placeholder; nothing is ever sent to
// it (".invalid" is a reserved TLD that never resolves).
export function placeholderEmail(name: string): string {
  return `${name.toLowerCase()}@users.safehub.invalid`;
}

// Passwords have no rules: any length, empty allowed. better-auth rejects
// empty passwords, so every password gets this fixed prefix before it reaches
// better-auth (hashing and checking). Use toStoredPassword() wherever a
// password is set or checked, or logins will fail.
const PASSWORD_PREFIX = "safehub:";

export function toStoredPassword(password: string): string {
  return PASSWORD_PREFIX + password;
}

// Runs first-run setups one after another. Otherwise two parallel requests
// could both pass the "no user yet" check in the sign-up hook and both
// create an admin. Works because SafeHub is a single process.
let setupQueue: Promise<unknown> = Promise.resolve();

export function createFirstAdmin<T>(create: () => Promise<T>): Promise<T> {
  const run = setupQueue.then(create);
  setupQueue = run.catch(() => undefined);
  return run;
}

// Failed sign-ins per account, plus a global cap against spraying many
// usernames. Keyed on the username, not the IP: X-Forwarded-For is
// client-supplied when nothing sits in front of SafeHub, so IP keys are easy
// to dodge. The hooks run for Server Action calls (auth.api) too.
const accountLimiter = createFailureLimiter({ maxFailures: 5, windowMs: 15 * 60_000 });
const globalLimiter = createFailureLimiter({ maxFailures: 50, windowMs: 15 * 60_000 });

const SIGN_IN_PATH = "/sign-in/username";

function signInKey(body: unknown): string {
  const name = (body as { username?: unknown } | undefined)?.username;
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS,
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  emailAndPassword: {
    enabled: true,
    // The prefix makes every password at least 1 character long. The maximum
    // only guards hashing cost; the form allows up to 1000 characters.
    minPasswordLength: 1,
    maxPasswordLength: PASSWORD_PREFIX.length + 1000,
  },
  telemetry: { enabled: false },
  // Without BETTER_AUTH_URL, better-auth cannot tell http from https and in
  // production would mark cookies Secure, which browsers drop on plain
  // http://<LAN IP>, so login would never stick. Plain cookies work on both;
  // set BETTER_AUTH_URL=https://... to get Secure cookies behind HTTPS.
  // (Login runs through Server Actions, whose origin Next.js checks itself.)
  ...(env.BETTER_AUTH_URL ? {} : { advanced: { useSecureCookies: false } }),
  // HTTP routes SafeHub does not use. Disabling them leaves auth.api calls
  // working:
  // - sign-up: accounts are only created by the setup Server Action
  // - email sign-in: emails are placeholders; login is by username
  // - username sign-in: the login Server Action is the only way in (it adds
  //   the password prefix)
  // - username availability: would let anyone probe which usernames exist
  disabledPaths: [
    "/sign-up/email",
    "/sign-in/email",
    "/sign-in/username",
    "/is-username-available",
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Sign-up is only open for the first-run setup. Once an admin exists,
      // new accounts are refused.
      if (ctx.path === "/sign-up/email" && (await hasAnyUser())) {
        throw new APIError("FORBIDDEN", {
          message: "Sign-up is closed.",
        });
      }
      if (ctx.path === SIGN_IN_PATH) {
        const waitMs = Math.max(
          accountLimiter.retryAfterMs(signInKey(ctx.body)),
          globalLimiter.retryAfterMs("global"),
        );
        if (waitMs > 0) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: `Too many failed sign-ins. Try again in ${Math.ceil(waitMs / 60_000)} min.`,
          });
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== SIGN_IN_PATH) return;
      const key = signInKey(ctx.body);
      if (isAPIError(ctx.context.returned)) {
        accountLimiter.recordFailure(key);
        globalLimiter.recordFailure("global");
      } else {
        accountLimiter.reset(key);
      }
    }),
  },
  plugins: [
    // Usernames: 3-30 characters, letters, digits, "_" and "."; stored lowercase.
    username({ displayUsername: false }),
    // Must be last so it can set cookies from Server Actions.
    nextCookies(),
  ],
});
