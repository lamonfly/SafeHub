import type { ErrorResult } from "@/lib/integrations/result";

// Why a service or machine did not answer as expected, in a few words for
// the alert title. "unreachable" is the fallback: no answer, timeouts and
// errors SafeHub cannot tell apart.
export type FailureReason =
  | "unreachable"
  | "login rejected"
  | "certificate changed"
  | "unexpected response (API changed?)"
  | "wrong URL"
  | "VPN not running";

export type Failure = { reason: FailureReason; detail: string };

// Error texts come from the adapters (http.ts, the Synology, qBittorrent and
// Gluetun clients, result.ts). Matching text keeps the adapters unchanged;
// an unknown text simply stays "unreachable".
const patterns: [RegExp, FailureReason][] = [
  [/Unexpected response format/i, "unexpected response (API changed?)"],
  [/web page instead of API data/i, "wrong URL"],
  [/^VPN is /i, "VPN not running"],
  [
    /login failed|rejected the username or password|banned SafeHub|needs a login|refused the session|refused the request \(401\)|\b(401|403) (Unauthorized|Forbidden)\b/i,
    "login rejected",
  ],
];

export function describeFailure(result: Pick<ErrorResult, "message" | "certificateChanged">): Failure {
  if (result.certificateChanged) return { reason: "certificate changed", detail: result.message };
  const match = patterns.find(([pattern]) => pattern.test(result.message));
  return { reason: match?.[1] ?? "unreachable", detail: result.message };
}

// Alert text for something that failed for `minutes` minutes in a row.
export function failureAlert(label: string, minutes: number, failure?: Failure): { title: string; message: string } {
  const reason = failure?.reason ?? "unreachable";
  const detail = failure?.detail ? ` ${failure.detail.replace(/\s+$/, "")}` : "";
  const separator = detail && !/[.!?]$/.test(detail) ? "." : "";
  return {
    title: `${label}: ${reason}`,
    message:
      reason === "unreachable"
        ? `No answer for ${minutes}+ minutes.${detail}${separator}`
        : `For ${minutes}+ minutes.${detail}${separator}`,
  };
}
