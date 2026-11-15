import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "../../tests/support/helpers";

let authModule: typeof import("./auth");
let db: Awaited<ReturnType<typeof migratedDb>>;
let schema: typeof import("@/db/schema");

beforeAll(async () => {
  db = await migratedDb();
  authModule = await import("./auth");
  schema = await import("@/db/schema");
});

const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { statusCode?: number; message: string }) => `${error.statusCode}:${error.message}`,
  );

function signUp(username: string, password = "") {
  const { auth, createFirstAdmin, placeholderEmail, toStoredPassword } = authModule;
  return createFirstAdmin(() =>
    auth.api.signUpEmail({
      body: { name: username, username, email: placeholderEmail(username), password: toStoredPassword(password) },
    }),
  );
}

function signIn(username: string, password: string) {
  const { auth, toStoredPassword } = authModule;
  return outcome(auth.api.signInUsername({ body: { username, password: toStoredPassword(password) } }));
}

describe("first-run setup", () => {
  it("creates exactly one admin even when two setups race", async () => {
    const results = await Promise.allSettled([signUp("Felix"), signUp("other")]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const users = db.select().from(schema.user).all();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ username: "felix", email: "felix@users.safehub.invalid" });
  });

  it("is closed afterwards", async () => {
    expect(await outcome(signUp("late"))).toBe("403:Sign-up is closed.");
  });
});

describe("sign-in", () => {
  it("accepts an empty password and ignores username case", async () => {
    expect(await signIn("FELIX", "")).toBe("ok");
    expect(await signIn("felix", "a")).toMatch(/^401:/);
  });

  it("blocks a username after 5 failures, even with the right password", async () => {
    // One failure is already recorded above; four more reach the limit.
    for (let attempt = 0; attempt < 4; attempt++) expect(await signIn("felix", "wrong")).toMatch(/^401:/);
    expect(await signIn("felix", "wrong")).toMatch(/^429:Too many failed sign-ins/);
    expect(await signIn("felix", "")).toMatch(/^429:/);
    // Other usernames are not affected by felix's lockout.
    expect(await signIn("someone_else", "x")).toMatch(/^401:/);
  });

  it("limits attempts sent in parallel too", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => signIn("parallel", "wrong")));
    expect(results.filter((result) => result.startsWith("401:"))).toHaveLength(5);
    expect(results.filter((result) => result.startsWith("429:"))).toHaveLength(15);
  });
});
