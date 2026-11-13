import { formatBytes, formatPercent, formatUptime } from "@/lib/format";
import { getProxmoxOverview } from "@/lib/integrations/proxmox";
import type { ProxmoxGuest, ProxmoxNode } from "@/lib/integrations/proxmox/schemas";
import { GuestActions } from "./guest-actions";

function StatusDot({ status }: { status: string }) {
  const color =
    status === "running" || status === "online"
      ? "bg-green-500"
      : status === "stopped" || status === "offline"
        ? "bg-foreground/30"
        : "bg-yellow-500";
  return <span className={`inline-block size-2 shrink-0 rounded-full ${color}`} title={status} />;
}

function memory(item: ProxmoxNode | ProxmoxGuest): string {
  return item.maxmem > 0 ? `${formatBytes(item.mem)} / ${formatBytes(item.maxmem)}` : "—";
}

function NodeSummary({ node }: { node: ProxmoxNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="flex items-center gap-2 font-medium">
        <StatusDot status={node.status} />
        {node.node}
      </span>
      <span className="text-foreground/70">
        CPU {formatPercent(node.cpu)} of {node.maxcpu}
      </span>
      <span className="text-foreground/70">RAM {memory(node)}</span>
      <span className="text-foreground/70">Up {formatUptime(node.uptime)}</span>
    </div>
  );
}

export async function ProxmoxCard() {
  const result = await getProxmoxOverview();

  return (
    <section className="rounded-lg border border-foreground/15 p-4">
      <h2 className="mb-3 text-lg font-semibold">Proxmox</h2>

      {result.status === "not-configured" && (
        <p className="text-sm text-foreground/70">
          Not configured. Set <code>PROXMOX_URL</code>, <code>PROXMOX_TOKEN_ID</code> and{" "}
          <code>PROXMOX_TOKEN_SECRET</code> in <code>.env.local</code>.
        </p>
      )}

      {result.status === "error" && (
        <p role="alert" className="text-sm text-red-500">
          Unreachable: {result.message}
        </p>
      )}

      {result.status === "ok" && (
        <div className="flex flex-col gap-4">
          {result.data.nodes.map((node) => (
            <NodeSummary key={node.node} node={node} />
          ))}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-foreground/60">
                <tr>
                  <th className="py-2 pr-3 font-normal">ID</th>
                  <th className="py-2 pr-3 font-normal">Name</th>
                  <th className="py-2 pr-3 font-normal">Type</th>
                  <th className="py-2 pr-3 font-normal">CPU</th>
                  <th className="py-2 pr-3 font-normal">RAM</th>
                  <th className="py-2 pr-3 font-normal">Uptime</th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {result.data.guests.map((guest) => (
                  <tr key={`${guest.node}/${guest.vmid}`} className="border-t border-foreground/10">
                    <td className="py-2 pr-3 tabular-nums">{guest.vmid}</td>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <StatusDot status={guest.status} />
                        {guest.name ?? "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 uppercase text-foreground/60">
                      {guest.type === "qemu" ? "VM" : "LXC"}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {guest.status === "running" ? formatPercent(guest.cpu) : "—"}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                      {guest.status === "running" ? memory(guest) : "—"}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{formatUptime(guest.uptime)}</td>
                    <td className="py-2">
                      <GuestActions guest={guest} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.data.guests.length === 0 && (
              <p className="py-2 text-sm text-foreground/70">No VMs or containers.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
