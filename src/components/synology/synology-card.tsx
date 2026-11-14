import { CertificateChanged } from "@/components/certificate/certificate-changed";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { UsageBar } from "@/components/ui/usage-bar";
import { formatBytes, formatUptime } from "@/lib/format";
import { getSynologyOverview } from "@/lib/integrations/synology";
import { series } from "@/lib/metrics/series";
import { readTrends } from "@/lib/metrics/store";
import { HistoryLink } from "@/components/history/history-link";

export async function SynologyCard() {
  const result = await getSynologyOverview();
  // Unconfigured: show nothing (the dashboard normally skips the card).
  if (result.status === "not-configured") return null;

  const subtitle =
    result.status === "ok"
      ? [
          result.data.model,
          result.data.firmware,
          result.data.uptimeSeconds !== undefined && `up ${formatUptime(result.data.uptimeSeconds)}`,
          result.data.temperature !== undefined && `${result.data.temperature} °C`,
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  const trends =
    result.status === "ok"
      ? readTrends([
          series.synologyCpu,
          series.synologyRam,
          ...result.data.volumes.map((volume) => series.synologyVolume(volume.name)),
        ])
      : new Map<string, number[]>();

  return (
    <Card title={<HistoryLink href="/history/synology">Synology</HistoryLink>} subtitle={subtitle}>
      {result.status === "error" &&
        (result.certificateChanged ? (
          <CertificateChanged message={result.message} {...result.certificateChanged} />
        ) : (
          <Banner tone="error">Unreachable: {result.message}</Banner>
        ))}

      {result.status === "ok" && (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <UsageBar label="CPU" percent={result.data.cpuPercent} trend={trends.get(series.synologyCpu)} />
            <UsageBar
              label="RAM"
              percent={result.data.memory.usedPercent}
              detail={`of ${formatBytes(result.data.memory.totalBytes)}`}
              trend={trends.get(series.synologyRam)}
            />
          </div>

          {result.data.volumes.map((volume) => (
            <div key={volume.name} className="flex flex-col gap-1">
              <UsageBar
                label={volume.name}
                percent={volume.totalBytes > 0 ? (volume.usedBytes / volume.totalBytes) * 100 : 0}
                detail={`${formatBytes(volume.usedBytes)} / ${formatBytes(volume.totalBytes)}`}
                trend={trends.get(series.synologyVolume(volume.name))}
              />
              {volume.status !== "normal" && (
                <span className="text-xs font-medium text-error">Status: {volume.status}</span>
              )}
            </div>
          ))}

          {result.data.disks.length > 0 && (
            <ul className="grid gap-x-6 sm:grid-cols-2">
              {result.data.disks.map((disk) => {
                // DSM reports "normal" for healthy disks.
                const healthy = disk.status === "normal";
                return (
                  <li
                    key={disk.name}
                    className="flex min-h-12 items-center justify-between gap-3 border-b border-outline-variant text-sm last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <StatusDot tone={healthy ? "success" : "error"} label={disk.status} />
                      <span className="min-w-0">
                        <span className="block truncate text-on-surface">{disk.name}</span>
                        {disk.model && <span className="block truncate text-xs text-on-surface-variant">{disk.model}</span>}
                      </span>
                    </span>
                    <span className="shrink-0 text-on-surface-variant tabular-nums">
                      <span className={healthy ? "" : "font-medium text-error"}>{disk.status}</span>
                      {disk.temperature !== undefined && ` · ${disk.temperature} °C`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
