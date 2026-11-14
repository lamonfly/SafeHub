import { getServiceStatuses, type ServiceStatus } from "@/lib/integrations/services";

function ServiceTile({ service }: { service: ServiceStatus }) {
  const { result } = service;
  const hasIssues = result.status === "ok" && result.data.issues.length > 0;
  const dot = result.status === "error" ? "bg-red-500" : hasIssues ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-foreground/10 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          <span className={`inline-block size-2 shrink-0 rounded-full ${dot}`} />
          {service.url ? (
            <a href={service.url} target="_blank" rel="noreferrer" className="hover:underline">
              {service.name}
            </a>
          ) : (
            service.name
          )}
        </span>
        {result.status === "ok" && result.data.version && (
          <span className="truncate text-xs text-foreground/50">v{result.data.version}</span>
        )}
      </div>

      {result.status === "error" && (
        <p role="alert" className="text-xs break-words text-red-500">
          {result.message}
        </p>
      )}

      {result.status === "ok" && (
        <>
          {result.data.stats.length > 0 && (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {result.data.stats.map((stat) => (
                <div key={stat.label} className="flex gap-1">
                  <dt className="text-foreground/60">{stat.label}</dt>
                  <dd className="tabular-nums">{stat.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {hasIssues && (
            <ul className="flex flex-col gap-0.5 text-xs text-yellow-600 dark:text-yellow-400">
              {result.data.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export async function ServicesCard() {
  // Only configured services are returned; the dashboard skips this card
  // when there are none.
  const statuses = await getServiceStatuses();
  if (statuses.length === 0) return null;

  return (
    <section className="rounded-lg border border-foreground/15 p-4">
      <h2 className="mb-3 text-lg font-semibold">Services</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statuses.map((service) => (
          <ServiceTile key={service.key} service={service} />
        ))}
      </div>
    </section>
  );
}
