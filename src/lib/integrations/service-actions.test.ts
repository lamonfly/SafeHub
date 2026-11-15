import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, migratedDb, startHttp } from "../../../tests/support/helpers";

// Fake Sonarr, Prowlarr and Jellyfin on one server, told apart by path.
const received: { method: string; url: string; body: string }[] = [];
let server: Awaited<ReturnType<typeof startHttp>>;
let services: typeof import("./services");

beforeAll(async () => {
  server = await startHttp((request, body, response) => {
    received.push({ method: request.method!, url: request.url!, body });
    if (request.url === "/sonarr/api/v3/command") return json(response, { id: 1, name: JSON.parse(body).name }, 201);
    // Like Prowlarr: 400 with the results when any indexer fails.
    if (request.url === "/prowlarr/api/v1/indexer/testall") return json(response, [{ isValid: true }, { isValid: false }, { isValid: true }], 400, "Bad Request");
    if (request.url === "/jellyfin/Library/Refresh") {
      response.writeHead(204);
      return response.end();
    }
    return json(response, { message: "not found" }, 404, "Not Found");
  });
  process.env.SONARR_URL = `${server.url}/sonarr`;
  process.env.SONARR_API_KEY = "k";
  process.env.PROWLARR_URL = `${server.url}/prowlarr`;
  process.env.PROWLARR_API_KEY = "k";
  process.env.JELLYFIN_URL = `${server.url}/jellyfin`;
  process.env.JELLYFIN_API_KEY = "k";
  await migratedDb();
  services = await import("./services");
});
afterAll(() => server.close());

describe("service actions", () => {
  it("start a Sonarr command with a JSON body", async () => {
    expect(await services.runServiceAction("sonarr", "search-missing")).toEqual({ status: "ok", data: "Started." });
    const call = received.find((item) => item.url === "/sonarr/api/v3/command")!;
    expect(call.method).toBe("POST");
    expect(JSON.parse(call.body)).toEqual({ name: "MissingEpisodeSearch" });
  });

  it("report Prowlarr's indexer test result", async () => {
    expect(await services.runServiceAction("prowlarr", "test-indexers")).toEqual({ status: "ok", data: "1 of 3 indexers failed." });
  });

  it("accept an empty 204 answer (Jellyfin scan)", async () => {
    expect(await services.runServiceAction("jellyfin", "scan-library")).toEqual({ status: "ok", data: "Scan started." });
  });

  it("only run actions from the registry, for configured services", async () => {
    expect(await services.runServiceAction("sonarr", "delete-everything")).toEqual({ status: "error", message: "Unknown action." });
    expect(await services.runServiceAction("radarr", "refresh")).toEqual({ status: "not-configured" });
  });

  it("list the buttons without their run functions", async () => {
    const sonarr = (await services.getServiceStatuses()).find((service) => service.key === "sonarr")!;
    expect(sonarr.actions.map((action) => action.id)).toEqual(["search-missing", "refresh"]);
    expect(sonarr.actions[0]).not.toHaveProperty("run");
    expect(sonarr.actions[0].confirm).toContain("indexer API limits");
  });
});
