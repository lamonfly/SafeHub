import Link from "next/link";
import { listDevicesWithStatus } from "@/lib/wol";
import { WakeButton } from "./device-buttons";

function StatusDot({ online }: { online: boolean | null }) {
  const [color, label] =
    online === null
      ? ["bg-foreground/15", "No status check"]
      : online
        ? ["bg-green-500", "Online"]
        : ["bg-foreground/30", "Offline"];
  return <span className={`inline-block size-2 shrink-0 rounded-full ${color}`} title={label} />;
}

export async function WolCard() {
  const devices = await listDevicesWithStatus();

  return (
    <section className="rounded-lg border border-foreground/15 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Wake on LAN</h2>
        <Link href="/settings/wol" className="text-sm text-foreground/70 hover:underline">
          Manage
        </Link>
      </div>

      {devices.length === 0 ? (
        <p className="text-sm text-foreground/70">
          No devices yet. <Link href="/settings/wol" className="underline">Add one</Link>.
        </p>
      ) : (
        <ul className="flex flex-col">
          {devices.map((device) => (
            <li
              key={device.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-foreground/10 py-2 first:border-t-0"
            >
              <span className="flex items-center gap-2 text-sm">
                <StatusDot online={device.online} />
                <span className="font-medium">{device.name}</span>
                <span className="text-foreground/50">
                  {device.online === null ? "" : device.online ? "online" : "offline"}
                </span>
              </span>
              <WakeButton id={device.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
