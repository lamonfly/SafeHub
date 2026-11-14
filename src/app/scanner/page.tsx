import Link from "next/link";
import { DiscoveryForm, HostPortScanButton, PortScanForm } from "@/components/scanner/scan-forms";
import { formatTimeAgo } from "@/lib/format";
import { knownPorts } from "@/lib/net/ports";
import { localSubnets } from "@/lib/net/subnet";
import { getScannerOverview, type HostView } from "@/lib/scanner";
import { requireSession } from "@/lib/session";

function OpenPorts({ host }: { host: HostView }) {
  if (!host.portsScannedAt) return <span className="text-foreground/40">not scanned</span>;
  if (!host.openPorts?.length) return <span className="text-foreground/40">none</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {host.openPorts.map((port) => (
        <span
          key={port}
          title={knownPorts[port]}
          className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-xs"
        >
          {port}
          {knownPorts[port] && <span className="text-foreground/60"> {knownPorts[port]}</span>}
        </span>
      ))}
    </span>
  );
}

export default async function ScannerPage() {
  await requireSession();
  const { lastRun, hosts } = await getScannerOverview();

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-sm text-foreground/70 hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-semibold">Network scanner</h1>
      </header>

      <section className="grid gap-6 rounded-lg border border-foreground/15 p-4 md:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Discover hosts</h2>
          <DiscoveryForm subnets={localSubnets()} />
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold">Port scan</h2>
          <PortScanForm />
        </div>
      </section>

      <section className="rounded-lg border border-foreground/15 p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Hosts</h2>
          {lastRun && (
            <span className="text-sm text-foreground/60">
              Last scan {lastRun.cidr}, {formatTimeAgo(lastRun.startedAt)}
              {lastRun.hostsFound !== null && `, ${lastRun.hostsFound} hosts`}
            </span>
          )}
        </div>

        {hosts.length === 0 ? (
          <p className="text-sm text-foreground/70">No scans yet. Run a discovery scan above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-foreground/60">
                <tr>
                  <th className="py-2 pr-3 font-normal">IP</th>
                  <th className="py-2 pr-3 font-normal">Hostname</th>
                  <th className="py-2 pr-3 font-normal">Vendor</th>
                  <th className="py-2 pr-3 font-normal">MAC</th>
                  <th className="py-2 pr-3 font-normal">Open ports</th>
                  <th className="py-2 pr-3 font-normal">Last seen</th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {hosts.map((host) => (
                  <tr key={host.id} className="border-t border-foreground/10 align-top">
                    <td className="py-2 pr-3 font-mono whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        <span
                          className={`inline-block size-2 shrink-0 rounded-full ${
                            host.seenInLastScan ? "bg-green-500" : "bg-foreground/30"
                          }`}
                          title={host.seenInLastScan ? "Seen in last scan" : "Not seen in last scan"}
                        />
                        {host.ip}
                        {host.isNew && (
                          <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 font-sans text-xs text-yellow-600 dark:text-yellow-400">
                            NEW
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{host.hostname ?? "—"}</td>
                    <td className="py-2 pr-3">{host.vendor ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono whitespace-nowrap">{host.mac ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <OpenPorts host={host} />
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatTimeAgo(host.lastSeenAt)}</td>
                    <td className="py-2">
                      <HostPortScanButton ip={host.ip} />
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
