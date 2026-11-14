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
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl leading-8 text-on-surface">Welcome to SafeHub</h1>
        <p className="text-sm text-on-surface-variant">Create the admin account. Sign-up closes after this.</p>
      </div>
      <AuthForm
        action={createAdmin}
        submitLabel="Create account"
        fields={[
          {
            name: "username",
            label: "Username",
            supportingText: "Letters, digits, _ and .",
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
