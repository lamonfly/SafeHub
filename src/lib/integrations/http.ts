import "server-only";
import { fetch, type Agent } from "undici";
import { z } from "zod";

const TIMEOUT_MS = 5_000;

export type HttpClient = {
  baseUrl: URL;
  get<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>>;
  post<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>>;
};

// JSON client for one service: base URL, auth headers, optional TLS agent,
// and a timeout on every request. Paths are relative to baseUrl.
export function createHttpClient(options: {
  name: string;
  baseUrl: string;
  headers?: Record<string, string>;
  dispatcher?: Agent;
}): HttpClient {
  // Trailing slash so relative paths append instead of replacing the last segment.
  const baseUrl = new URL(options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);

  async function request<T extends z.ZodType>(method: string, path: string, schema: T) {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: { Accept: "application/json", ...options.headers },
      dispatcher: options.dispatcher,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`${options.name} ${response.status} ${response.statusText}`.trim());
    }
    // A web page instead of JSON almost always means the URL points at the
    // app's web UI (e.g. Jellyfin's /web/#/home copied from the browser) or a
    // login page in front of it, not at the server's API.
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      throw new Error(
        `${options.name} answered with a web page instead of API data. Check the URL: use the server address (e.g. http://192.168.1.20:8096), not a page of its web interface or a login page in front of it.`,
      );
    }
    return schema.parse(await response.json()) as z.infer<T>;
  }

  return {
    baseUrl,
    get: (path, schema) => request("GET", path, schema),
    post: (path, schema) => request("POST", path, schema),
  };
}

// Shared shape for the service tiles on the dashboard.
export type ServiceSummary = {
  version?: string;
  stats: { label: string; value: string | number }[];
  issues: string[];
};
