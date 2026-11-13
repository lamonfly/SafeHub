import { redirect } from "next/navigation";
import { connection } from "next/server";
import { hasAnyUser } from "@/lib/auth";
import { createAdmin } from "../actions";
import { AuthForm } from "../auth-form";

// First-run only: creates the admin account. Closed once a user exists.
export default async function SetupPage() {
  await connection(); // user count is live data, never prerender
  if (await hasAnyUser()) redirect("/login");

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold">Welcome to SafeHub</h1>
      <p className="mb-6 text-sm text-foreground/70">
        Create the admin account. Sign-up closes after this.
      </p>
      <AuthForm
        action={createAdmin}
        submitLabel="Create account"
        fields={[
          {
            name: "username",
            label: "Username (letters, digits, _ and .)",
            type: "text",
            autoComplete: "username",
          },
          {
            name: "password",
            label: "Password (optional)",
            type: "password",
            autoComplete: "new-password",
            required: false,
          },
        ]}
      />
    </>
  );
}
