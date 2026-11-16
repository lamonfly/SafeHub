import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { certificate, json, migratedDb, startHttps } from "../../../tests/support/helpers";

// Certificate pinning (trust on first use), through the Proxmox adapter.
let server: Awaited<ReturnType<typeof startHttps>>;
let proxmox: typeof import("./proxmox");
let tls: typeof import("./tls");
const certA = await certificate("pve");
const certB = await certificate("pve");

beforeAll(async () => {
  server = await startHttps((request, _body, response) => {
    if (request.url!.endsWith("/nodes")) return json(response, { data: [{ node: "pve", status: "online" }] });
    return json(response, { data: [] });
  }, certA);
  process.env.PROXMOX_URL = server.url;
  process.env.PROXMOX_TOKEN_ID = "safehub@pve!safehub";
  process.env.PROXMOX_TOKEN_SECRET = "secret";
  await migratedDb();
  proxmox = await import("./proxmox");
  tls = await import("./tls");
});
afterAll(() => server.close());

describe("certificate pinning", () => {
  it("trusts the first certificate and keeps trusting it", async () => {
    expect(await proxmox.getProxmoxOverview()).toMatchObject({ status: "ok" });
    await server.swap(certA);
    expect((await proxmox.getProxmoxOverview()).status).toBe("ok");
  });

  it("refuses a different certificate until it is accepted", async () => {
    await server.swap(certB);
    const changed = await proxmox.getProxmoxOverview();
    expect(changed.status).toBe("error");
    const details = changed.status === "error" ? changed.certificateChanged : undefined;
    expect(details?.pinId).toBe(`proxmox@localhost:${server.port}`);

    expect(tls.acceptCertificate(details!.pinId, "not-a-fingerprint")).toBe(false);
    // Only the certificate the service presented can be pinned, not any
    // well-formed fingerprint a request sends.
    const other = "AB:".repeat(31) + "AB";
    expect(tls.acceptCertificate(details!.pinId, other)).toBe(false);
    expect(tls.acceptCertificate("proxmox@elsewhere:8006", details!.fingerprint)).toBe(false);
    expect(tls.acceptCertificate(details!.pinId, details!.fingerprint)).toBe(true);
    // Used up: accepting again needs a new mismatch.
    expect(tls.acceptCertificate(details!.pinId, details!.fingerprint)).toBe(false);
    expect((await proxmox.getProxmoxOverview()).status).toBe("ok");
  });

  it("refuses going back to the old certificate", async () => {
    await server.swap(certA);
    const result = await proxmox.getProxmoxOverview();
    expect(result.status === "error" && result.certificateChanged).toBeTruthy();
  });
});
