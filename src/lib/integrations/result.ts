import { z } from "zod";

// Every integration call returns one of these, so a service being down or
// unconfigured never throws into the page.
export type IntegrationResult<T> =
  | { status: "ok"; data: T }
  | { status: "not-configured" }
  | { status: "error"; message: string };

// Runs an integration call, turning thrown errors into an error result.
export async function attempt<T>(fn: () => Promise<T>): Promise<IntegrationResult<T>> {
  try {
    return { status: "ok", data: await fn() };
  } catch (error) {
    return errorResult(error);
  }
}

const loggedSchemaErrors = new Set<string>();

export function errorResult(error: unknown): { status: "error"; message: string } {
  // The API answered, but not in the shape the adapter expects (e.g. a new
  // service version). Keep the tile short; put the details in the server log
  // once per distinct error, not on every refresh.
  if (error instanceof z.ZodError) {
    const details = z.prettifyError(error);
    if (!loggedSchemaErrors.has(details)) {
      loggedSchemaErrors.add(details);
      console.warn(`Unexpected integration response:\n${details}`);
    }
    return { status: "error", message: "Unexpected response format (details in server log)." };
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return { status: "error", message: "Request timed out." };
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return { status: "error", message: `${error.message}${cause}` };
  }
  return { status: "error", message: String(error) };
}
