// Every integration call returns one of these, so a service being down or
// unconfigured never throws into the page.
export type IntegrationResult<T> =
  | { status: "ok"; data: T }
  | { status: "not-configured" }
  | { status: "error"; message: string };

export function errorResult(error: unknown): { status: "error"; message: string } {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return { status: "error", message: "Request timed out." };
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return { status: "error", message: `${error.message}${cause}` };
  }
  return { status: "error", message: String(error) };
}
