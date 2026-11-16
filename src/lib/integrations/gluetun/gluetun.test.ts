import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, migratedDb, startHttp } from "../../../../tests/support/helpers";

let vpnStatus = "running";
let server: Awaited<ReturnType<typeof startHttp>>;
let gluetun: typeof import(".");

beforeAll(async () => {
  server = await startHttp((request, _body, response) => {
    if (request.headers["x-api-key"] !== "k") return json(response, { error: "unauthorized" }, 401, "Unauthorized");
    if (request.url === "/v1/vpn/status") return json(response, { status: vpnStatus });
    if (request.url === "/v1/publicip/ip") return json(response, { public_ip: "203.0.113.7", country: "Switzerland", city: "Zurich" });
    // Route not in the role: the stat is left out, the tile stays fine.
    if (request.url === "/v1/portforward") return json(response, { error: "unauthorized" }, 401, "Unauthorized");
    return json(response, { message: "not found" }, 404, "Not Found");
  });
  process.env.GLUETUN_URL = server.url;
  process.env.GLUETUN_API_KEY = "k";
  await migratedDb();
  gluetun = await import(".");
});
afterAll(() => server.close());

describe("Gluetun", () => {
  it("shows the public IP and location while the VPN runs", async () => {
    expect(await gluetun.gluetunSummary(gluetun.getGluetunClient()!)).toEqual({
      stats: [
        { label: "Public IP", value: "203.0.113.7" },
        { label: "Location", value: "Zurich, Switzerland" },
      ],
      issues: [],
    });
  });

  it("reads the forwarded port from the older route when the new one is missing", async () => {
    const fake = await startHttp((request, _body, response) => {
      if (request.url === "/v1/openvpn/portforwarded") return json(response, { port: 40000 });
      return json(response, { message: "not found" }, 404, "Not Found");
    });
    const client = (await import("../http")).createHttpClient({ name: "Gluetun", baseUrl: fake.url });
    expect(await gluetun.getForwardedPort(client)).toBe(40000);
    await fake.close();
  });

  it("treats port 0 as no forwarded port", async () => {
    const fake = await startHttp((_request, _body, response) => json(response, { port: 0 }));
    const client = (await import("../http")).createHttpClient({ name: "Gluetun", baseUrl: fake.url });
    expect(await gluetun.getForwardedPort(client)).toBeNull();
    await fake.close();
  });

  it("fails when the VPN is not running, so the service alert opens", async () => {
    vpnStatus = "stopped";
    await expect(gluetun.gluetunSummary(gluetun.getGluetunClient()!)).rejects.toThrow("VPN is stopped.");
    vpnStatus = "running";
  });
});
