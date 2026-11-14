import { CertificateChanged } from "@/components/certificate/certificate-changed";
import { UsageBar } from "@/components/ui/usage-bar";
import { formatBytes, formatUptime } from "@/lib/format";
import { getSynologyOverview } from "@/lib/integrations/synology";

// DSM reports "normal" for healthy volumes and disks.
function healthClass(status: string): string {
  return status === "normal" ? "text-foreground/60" : "font-medium text-red-500";
}

export async function SynologyCard() {
  const result = await getSynologyOverview();
  // Unconfigured: show nothing (the dashboard normally skips the card).
  if (result.status === "not-configured") return null;

  return (
    <section className="rounded-lg border border-foreground/15 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-lg font-semibold">Synology</h2>
        {result.status === "ok" && (
          <span className="text-sm text-foreground/60">
            {[
              result.data.model,
              result.data.firmware,
              result.data.uptimeSeconds !== undefined && `up ${formatUptime(result.data.uptimeSeconds)}`,
              result.data.temperature !== undefined && `${result.data.temperature} °C`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </div>

      {result.status === "error" &&
        (result.certificateChanged ? (
          <CertificateChanged message={result.message} {...result.certificateChanged} />
        ) : (
          <p role="alert" className="text-sm text-red-500">
            Unreachable: {result.message}
          </p>
        ))}

      {result.status === "ok" && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <UsageBar label="CPU" percent={result.data.cpuPercent} />
            <UsageBar
              label="RAM"
              percent={result.data.memory.usedPercent}
              detail={`of ${formatBytes(result.data.memory.totalBytes)}`}
            />
          </div>

          {result.data.volumes.map((volume) => (
            <div key={volume.name} className="flex flex-col gap-1">
              <UsageBar
                label={volume.name}
                percent={volume.totalBytes > 0 ? (volume.usedBytes / volume.totalBytes) * 100 : 0}
                detail={`${formatBytes(volume.usedBytes)} / ${formatBytes(volume.totalBytes)}`}
              />
              {volume.status !== "normal" && (
                <span className={`text-xs ${healthClass(volume.status)}`}>Status: {volume.status}</span>
              )}
            </div>
          ))}

          {result.data.disks.length > 0 && (
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {result.data.disks.map((disk) => (
                <li key={disk.name} className="flex justify-between gap-2">
                  <span className="truncate" title={disk.model}>
                    {disk.name}
                  </span>
                  <span className="whitespace-nowrap">
                    <span className={healthClass(disk.status)}>{disk.status}</span>
                    {disk.temperature !== undefined && (
                      <span className="text-foreground/60"> · {disk.temperature} °C</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
