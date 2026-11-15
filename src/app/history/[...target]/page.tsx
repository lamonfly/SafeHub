import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader, PageBody } from "@/components/app-header";
import { HistoryChart } from "@/components/history/history-chart";
import { Card } from "@/components/ui/card";
import { getProxmoxOverview } from "@/lib/integrations/proxmox";
import { series } from "@/lib/metrics/series";
import { knownSeries, rangeNames, readSeries, type Range } from "@/lib/metrics/store";
import { requireSession } from "@/lib/session";

// History charts for one machine:
//   /history/synology
//   /history/node/<node>
//   /history/guest/<node>/<vmid>
// ?range=24h|7d|30d|90d

type Chart = { series: string; title: string };

async function describe(target: string[]): Promise<{ title: string; charts: Chart[] } | null> {
  const [kind, node, vmid] = target;
  if (kind === "synology" && target.length === 1) {
    const volumes = knownSeries(series.synologyVolume(""));
    return {
      title: "Synology",
      charts: [
        { series: series.synologyCpu, title: "CPU" },
        { series: series.synologyRam, title: "Memory" },
        ...volumes.map((name) => ({ series: name, title: `Volume ${name.slice(series.synologyVolume("").length)}` })),
      ],
    };
  }
  if (kind === "node" && node && target.length === 2) {
    return {
      title: `Proxmox node ${node}`,
      charts: [
        { series: series.nodeCpu(node), title: "CPU" },
        { series: series.nodeRam(node), title: "Memory" },
      ],
    };
  }
  if (kind === "guest" && node && /^\d+$/.test(vmid ?? "") && target.length === 3) {
    const id = Number(vmid);
    const overview = await getProxmoxOverview();
    const guest = overview.status === "ok" ? overview.data.guests.find((g) => g.node === node && g.vmid === id) : undefined;
    return {
      title: guest?.name ? `${guest.name} (${guest.type === "qemu" ? "VM" : "LXC"} ${id})` : `Guest ${id}`,
      charts: [
        { series: series.guestCpu(node, id), title: "CPU" },
        { series: series.guestRam(node, id), title: "Memory" },
      ],
    };
  }
  return null;
}

export default async function HistoryPage({ params, searchParams }: PageProps<"/history/[...target]">) {
  const { user } = await requireSession();
  const { target } = await params;
  const requested = (await searchParams).range;
  const range: Range = rangeNames.includes(requested as Range) ? (requested as Range) : "24h";

  let segments: string[];
  try {
    segments = target.map(decodeURIComponent);
  } catch {
    notFound(); // malformed escape such as %E0
  }
  const description = await describe(segments);
  if (!description) notFound();
  const data = readSeries(description.charts.map((chart) => chart.series), range);

  return (
    <>
      <AppHeader userName={user.name} />
      <PageBody>
        <div className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <Link href="/" className="text-sm text-primary hover:underline">
              ← Dashboard
            </Link>
            <h1 className="text-[28px] leading-9 text-on-surface">{description.title}</h1>
          </div>
          {/* M3 segmented button for the time range */}
          <nav className="flex overflow-hidden rounded-full border border-outline" aria-label="Time range">
            {rangeNames.map((name) => (
              <Link
                key={name}
                href={`?range=${name}`}
                aria-current={name === range ? "page" : undefined}
                className={`flex min-h-10 min-w-14 items-center justify-center border-r border-outline px-3 text-sm font-medium last:border-r-0 ${
                  name === range ? "bg-secondary-container text-on-secondary-container" : "text-on-surface hover:bg-on-surface/8"
                }`}
              >
                {name}
              </Link>
            ))}
          </nav>
        </div>
        {description.charts.map((chart) => (
          <Card key={chart.series} title={chart.title} subtitle="Average (filled) and peak (dashed)">
            <HistoryChart points={data.get(chart.series) ?? []} longRange={range !== "24h"} />
          </Card>
        ))}
      </PageBody>
    </>
  );
}
