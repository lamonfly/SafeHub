import { CertificateChanged } from "@/components/certificate/certificate-changed";
import { Card, Tile } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { getServiceStatuses, type ServiceStatus } from "@/lib/integrations/services";

function ServiceTile({ service }: { service: ServiceStatus }) {
  const { result } = service;
  const hasIssues = result.status === "ok" && result.data.issues.length > 0;
  const [tone, label] =
    result.status === "error"
      ? (["error", "Unreachable"] as const)
      : hasIssues
        ? (["warning", "Has warnings"] as const)
        : (["success", "Running"] as const);

  return (
    <Tile>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot tone={tone} label={label} />
          {service.url ? (
            <a
              href={service.url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-base font-medium text-on-surface hover:underline"
            >
              {service.name}
            </a>
          ) : (
            <span className="truncate text-base font-medium text-on-surface">{service.name}</span>
          )}
        </span>
        {result.status === "ok" && result.data.version && (
          <span className="shrink-0 truncate text-xs text-on-surface-variant">v{result.data.version}</span>
        )}
      </div>

      {result.status === "error" &&
        (result.certificateChanged ? (
          <CertificateChanged message={result.message} {...result.certificateChanged} />
        ) : (
          <p className="text-sm break-words text-error">{result.message}</p>
        ))}

      {result.status === "ok" && (
        <>
          {result.data.stats.length > 0 && (
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-x-2 gap-y-3">
              {result.data.stats.map((stat) => (
                <div key={stat.label} className="min-w-0">
                  <dd className="text-[22px] leading-7 whitespace-nowrap text-on-surface tabular-nums">{stat.value}</dd>
                  <dt className="truncate text-xs text-on-surface-variant">{stat.label}</dt>
                </div>
              ))}
            </dl>
          )}
          {hasIssues && (
            <ul className="flex flex-col gap-1 rounded-lg bg-warning-container px-3 py-2 text-xs text-on-warning-container">
              {result.data.issues.map((issue) => (
                <li key={issue} className="break-words">
                  {issue}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Tile>
  );
}

export async function ServicesCard() {
  // Only configured services are returned; the dashboard skips this card
  // when there are none.
  const statuses = await getServiceStatuses();
  if (statuses.length === 0) return null;

  return (
    <Card title="Services">
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
        {statuses.map((service) => (
          <ServiceTile key={service.key} service={service} />
        ))}
      </div>
    </Card>
  );
}
