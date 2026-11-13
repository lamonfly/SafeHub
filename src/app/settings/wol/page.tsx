import Link from "next/link";
import { AddDeviceForm } from "@/components/wol/add-device-form";
import { DeleteDeviceButton } from "@/components/wol/device-buttons";
import { requireSession } from "@/lib/session";
import { listDevices } from "@/lib/wol";

// Query params (from the scanner "Add to WoL" link) prefill the form.
export default async function WolSettingsPage({ searchParams }: PageProps<"/settings/wol">) {
  await requireSession();
  const devices = await listDevices();
  const params = await searchParams;
  const prefill = Object.fromEntries(
    (["name", "mac", "host"] as const).map((key) => [key, typeof params[key] === "string" ? params[key] : undefined]),
  );

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-sm text-foreground/70 hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-semibold">Wake on LAN devices</h1>
      </header>

      <section className="rounded-lg border border-foreground/15 p-4">
        <h2 className="mb-3 text-lg font-semibold">Add device</h2>
        <AddDeviceForm key={JSON.stringify(prefill)} defaults={prefill} />
      </section>

      <section className="rounded-lg border border-foreground/15 p-4">
        <h2 className="mb-3 text-lg font-semibold">Devices</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-foreground/70">No devices yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-foreground/60">
                <tr>
                  <th className="py-2 pr-3 font-normal">Name</th>
                  <th className="py-2 pr-3 font-normal">MAC</th>
                  <th className="py-2 pr-3 font-normal">Broadcast</th>
                  <th className="py-2 pr-3 font-normal">Status check</th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.id} className="border-t border-foreground/10">
                    <td className="py-2 pr-3 font-medium">{device.name}</td>
                    <td className="py-2 pr-3 font-mono">{device.mac}</td>
                    <td className="py-2 pr-3 font-mono whitespace-nowrap">
                      {device.broadcast}:{device.port}
                    </td>
                    <td className="py-2 pr-3 font-mono whitespace-nowrap">
                      {device.host ? `${device.host}:${device.checkPort ?? 22}` : "—"}
                    </td>
                    <td className="py-2">
                      <DeleteDeviceButton id={device.id} name={device.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
