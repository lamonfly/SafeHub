import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader, PageBody } from "@/components/app-header";
import { HistoryChart } from "@/components/history/history-chart";
import { Card } from "@/components/ui/card";
import { getCachedProxmoxOverview } from "@/lib/integrations/proxmox";
import { parseHistoryTarget } from "@/lib/metrics/history-target";
import { series } from "@/lib/metrics/series";
import { knownSeries, rangeNames, readSeries, type Range } from "@/lib/metrics/store";
import { requireSession } from "@/lib/session";

// History charts for one machine or container (paths: lib/metrics/history-target.ts).
// ?range=24h|7d|30d|90d

type Chart = { series: string; title: string; subtitle?: string };

const DEFAULT_SUBTITLE = "Average (filled) and peak (dashed)";

async function describe(segments: string[]): Promise<{ title: string; charts: Chart[] } | null> {
  const target = parseHistoryTarget(segments);
  if (!target) return null;
  if (target.kind === "synology") {
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
  if (target.kind === "node") {
    const { node } = target;
    return {
      title: `Proxmox node ${node}`,
      charts: [
        { series: series.nodeCpu(node), title: "CPU" },
        { series: series.nodeRam(node), title: "Memory" },
      ],
    };
  }
  if (target.kind === "docker") {
    const { name } = target;
    return {
      title: `${name} (container)`,
      charts: [
        { series: series.dockerCpu(name), title: "CPU", subtitle: `Share of the whole host (all cores = 100%). ${DEFAULT_SUBTITLE}` },
        { series: series.dockerMemory(name), title: "Memory", subtitle: `Without page cache, of its limit or the host's memory. ${DEFAULT_SUBTITLE}` },
      ],
    };
  }
  const { node, vmid: id } = target;
  const overview = await getCachedProxmoxOverview();
  const guest = overview.status === "ok" ? overview.data.guests.find((g) => g.node === node && g.vmid === id) : undefined;
  return {
    title: guest?.name ? `${guest.name} (${guest.type === "qemu" ? "VM" : "LXC"} ${id})` : `Guest ${id}`,
    charts: [
      { series: series.guestCpu(node, id), title: "CPU" },
      { series: series.guestRam(node, id), title: "Memory" },
    ],
  };
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
            {/* after: extends the tap area to 48 px without moving the layout */}
            <Link
              href="/"
              className="relative inline-flex items-center text-sm text-primary after:absolute after:-inset-x-2 after:top-1/2 after:h-12 after:-translate-y-1/2 after:content-[''] hover:underline"
            >
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
                className={`flex min-h-12 min-w-14 sm:min-h-10 items-center justify-center border-r border-outline px-3 text-sm font-medium last:border-r-0 ${
                  name === range ? "bg-secondary-container text-on-secondary-container" : "text-on-surface hover:bg-on-surface/8"
                }`}
              >
                {name}
              </Link>
            ))}
          </nav>
        </div>
        {description.charts.map((chart) => (
          <Card key={chart.series} title={chart.title} subtitle={chart.subtitle ?? DEFAULT_SUBTITLE}>
            <HistoryChart points={data.get(chart.series) ?? []} longRange={range !== "24h"} />
          </Card>
        ))}
      </PageBody>
    </>
  );
}
