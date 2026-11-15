import { formatDuration } from "@/lib/format";
import type { IntegrationResult } from "@/lib/integrations/result";
import { PENDING_LIMIT, type SeerrRequest } from "@/lib/integrations/seerr";
import { SeerrRequestButtons } from "./seerr-request-buttons";

function describe(request: SeerrRequest): string {
  if (request.type === "movie") return "Movie";
  if (request.seasons.length === 0) return "Series";
  const seasons = [...request.seasons].sort((a, b) => a - b);
  return `Series · season${seasons.length > 1 ? "s" : ""} ${seasons.join(", ")}`;
}

// Pending requests inside the Seerr tile, newest first, as stacked rows.
export function SeerrRequests({ result }: { result: IntegrationResult<SeerrRequest[]> }) {
  if (result.status === "not-configured") return null;
  if (result.status === "error") {
    return <p className="text-xs break-words text-error">Pending requests: {result.message}</p>;
  }
  if (result.data.length === 0) return null;
  // Server component, rendered once per request: the current time is wanted.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <ul className="flex flex-col divide-y divide-outline-variant border-t border-outline-variant">
      {result.data.map((request) => (
        <li key={request.id} className="flex flex-col gap-2 py-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-on-surface">
                {request.title}
                {request.year && <span className="font-normal text-on-surface-variant"> ({request.year})</span>}
              </span>
              {request.is4k && (
                <span className="shrink-0 rounded bg-secondary-container px-1.5 text-[11px] leading-4 font-medium text-on-secondary-container">
                  4K
                </span>
              )}
            </div>
            <div className="truncate text-xs text-on-surface-variant">
              {describe(request)}
              {request.requestedBy && ` · ${request.requestedBy}`}
              {` · ${formatDuration(now - Date.parse(request.createdAt))} ago`}
            </div>
          </div>
          <SeerrRequestButtons id={request.id} title={request.title} />
        </li>
      ))}
      {result.data.length === PENDING_LIMIT && (
        <li className="pt-2 text-xs text-on-surface-variant">Showing the newest {PENDING_LIMIT}; more are waiting in Seerr.</li>
      )}
    </ul>
  );
}
