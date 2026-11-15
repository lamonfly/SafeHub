import "server-only";
import { fetch, type Agent } from "undici";
import { z } from "zod";

const TIMEOUT_MS = 5_000;

export type RequestOptions = {
  // Error statuses whose JSON body is still the answer, e.g. 400 from the
  // *arr apps' "test all" when some tests fail.
  acceptStatuses?: number[];
};

export type HttpClient = {
  baseUrl: URL;
  get<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>>;
  // body: sent as JSON.
  post<T extends z.ZodType>(path: string, schema: T, body?: unknown, options?: RequestOptions): Promise<z.infer<T>>;
};

// JSON client for one service: base URL, auth headers, optional TLS agent,
// and a timeout on every request. Paths are relative to baseUrl.
export function createHttpClient(options: {
  name: string;
  baseUrl: string;
  headers?: Record<string, string>;
  dispatcher?: Agent;
  // Default 5 s; longer only for calls that wait for work to finish.
  timeoutMs?: number;
}): HttpClient {
  // Trailing slash so relative paths append instead of replacing the last segment.
  const baseUrl = new URL(options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);

  async function request<T extends z.ZodType>(
    method: string,
    path: string,
    schema: T,
    body?: unknown,
    requestOptions: RequestOptions = {},
  ) {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      dispatcher: options.dispatcher,
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
    // No body: 204 No Content, or 304 Not Modified (SafeHub never sends
    // conditional requests; Docker uses it for "already in that state").
    if (response.status === 204 || response.status === 304) return schema.parse(undefined) as z.infer<T>;
    if (!response.ok && !requestOptions.acceptStatuses?.includes(response.status)) {
      // Release the connection now instead of when the body is collected.
      await response.body?.cancel();
      throw new Error(`${options.name} ${response.status} ${response.statusText}`.trim());
    }
    // A web page instead of JSON almost always means the URL points at the
    // app's web UI (e.g. Jellyfin's /web/#/home copied from the browser) or a
    // login page in front of it, not at the server's API.
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      // Where the request ended up tells the cause: a /web/ path means a
      // missing URL base, another host means a login page in front.
      const landed = response.redirected ? ` (redirected to ${response.url})` : "";
      await response.body?.cancel();
      throw new Error(
        `${options.name} answered with a web page instead of API data${landed}. Check the URL: use the server address including any URL base (e.g. http://192.168.1.20:8096 or .../jellyfin), not a page of its web interface or a login page in front of it.`,
      );
    }
    return schema.parse(await response.json()) as z.infer<T>;
  }

  return {
    baseUrl,
    get: (path, schema) => request("GET", path, schema),
    post: (path, schema, body, requestOptions) => request("POST", path, schema, body, requestOptions),
  };
}

// A button on a service tile (scan, refresh, search). run() returns a short
// result text, or nothing when the service only queued the work.
export type ServiceAction = {
  id: string;
  label: string;
  // Set for heavy actions: shown in a confirmation dialog first.
  confirm?: string;
  run: (client: HttpClient) => Promise<string | void>;
};

// Shared shape for the service tiles on the dashboard.
export type ServiceSummary = {
  version?: string;
  stats: { label: string; value: string | number }[];
  issues: string[];
};
