import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { ProxmoxCard } from "@/components/proxmox/proxmox-card";
import { WolCard } from "@/components/wol/wol-card";
import { requireSession } from "@/lib/session";
import { signOut } from "./(auth)/actions";

export default async function DashboardPage() {
  const { user } = await requireSession();

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">SafeHub</h1>
        <form action={signOut} className="flex items-center gap-3 text-sm">
          <Link href="/scanner" className="text-foreground/70 hover:underline">
            Scanner
          </Link>
          <span className="text-foreground/70">{user.email}</span>
          <button
            type="submit"
            className="rounded-md border border-foreground/20 px-3 py-1.5"
          >
            Sign out
          </button>
        </form>
      </header>
      <WolCard />
      <ProxmoxCard />
      <AutoRefresh intervalMs={10_000} />
    </main>
  );
}
