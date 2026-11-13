import { redirect } from "next/navigation";
import { connection } from "next/server";
import { hasAnyUser } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { signIn } from "../actions";
import { AuthForm } from "../auth-form";

export default async function LoginPage() {
  await connection(); // user count is live data, never prerender
  if (!(await hasAnyUser())) redirect("/setup");
  if (await getSession()) redirect("/");

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Sign in to SafeHub</h1>
      <AuthForm
        action={signIn}
        submitLabel="Sign in"
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "current-password",
          },
        ]}
      />
    </>
  );
}
