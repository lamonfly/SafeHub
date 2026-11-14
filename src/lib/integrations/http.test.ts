import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { json, startHttp } from "../../../tests/support/helpers";
import { createHttpClient } from "./http";
import { normalizeJellyfinUrl } from "./jellyfin";
import { attempt } from "./result";

// A Jellyfin with Base URL "/jellyfin": other paths redirect to its web UI.
let server: Awaited<ReturnType<typeof startHttp>>;
beforeAll(async () => {
  server = await startHttp((request, _body, response) => {
    if (request.url === "/jellyfin/web/") {
      response.writeHead(200, { "Content-Type": "text/html" });
      return response.end("<!doctype html>");
    }
    if (!request.url!.startsWith("/jellyfin/")) {
      response.writeHead(302, { Location: "/jellyfin/web/" });
      return response.end();
    }
    if (request.url === "/jellyfin/System/Info") return json(response, { Version: "10.10.3" });
    return json(response, { unexpected: true });
  });
});
afterAll(() => server.close());

describe("createHttpClient", () => {
  it("explains a web page answer and where it was redirected to", async () => {
    const result = await attempt(() =>
      createHttpClient({ name: "Jellyfin", baseUrl: server.url }).get("System/Info", z.object({})),
    );
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain("web page instead of API data");
    expect(result.status === "error" && result.message).toContain(`redirected to ${server.url}/jellyfin/web/`);
  });

  it("works with the URL base and keeps paths relative to it", async () => {
    const client = createHttpClient({ name: "Jellyfin", baseUrl: `${server.url}/jellyfin` });
    expect(await client.get("System/Info", z.object({ Version: z.string() }))).toEqual({ Version: "10.10.3" });
  });

  it("turns an unexpected response shape into a short message", async () => {
    const result = await attempt(() =>
      createHttpClient({ name: "Jellyfin", baseUrl: `${server.url}/jellyfin` }).get("Other", z.object({ needed: z.string() })),
    );
    expect(result).toEqual({ status: "error", message: "Unexpected response format (details in server log)." });
  });
});

describe("normalizeJellyfinUrl", () => {
  it.each([
    ["http://192.168.0.5:8096/web/#/home", "http://192.168.0.5:8096/"],
    ["http://192.168.0.5:8096/web/index.html#/home.html", "http://192.168.0.5:8096/"],
    ["https://media.lan/jellyfin/web/#/home", "https://media.lan/jellyfin/"],
    ["http://jellyfin:8096", "http://jellyfin:8096/"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeJellyfinUrl(input)).toBe(expected);
  });
});
