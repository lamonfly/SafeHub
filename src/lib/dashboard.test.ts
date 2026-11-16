import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProxmoxOverview } from "@/lib/integrations/proxmox";
import type { IntegrationResult } from "@/lib/integrations/result";

// Placement with a fake Proxmox whose answer the test controls; the real
// placement rules are tested in integrations/placement.test.ts.
const fake = vi.hoisted(() => ({
  overview: undefined as (() => Promise<unknown>) | undefined,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "safehub.lan:3000" }) }));
vi.mock("@/lib/integrations/proxmox", () => ({ getCachedProxmoxOverview: () => fake.overview!() }));
vi.mock("@/lib/integrations/docker", () => ({ isDockerConfigured: () => false, getDockerHost: async () => undefined }));
vi.mock("@/lib/integrations/seerr", () => ({ getSeerrPendingRequests: async () => undefined }));
vi.mock("@/lib/integrations/services", () => ({
  getServiceInfos: () => [{ key: "sonarr", name: "Sonarr", host: "192.168.1.30", actions: [] }],
  getServiceStatus: async () => null,
}));
vi.mock("@/lib/integrations/placement", () => ({
  // Everything runs on guest 100.
  placeServices: async (_guests: unknown, services: unknown[]) => new Map([["pve/100", services]]),
  placeDockerHost: () => undefined,
}));

let dashboard: typeof import("./dashboard");
beforeAll(async () => {
  dashboard = await import("./dashboard");
});
afterEach(() => vi.useRealTimers());

const ok: IntegrationResult<ProxmoxOverview> = {
  status: "ok",
  data: { nodes: [], guests: [{ node: "pve", vmid: 100 }] as ProxmoxOverview["guests"], backups: null },
};
const never = () => new Promise<never>(() => {});

async function placementWithin(ms: number) {
  vi.useFakeTimers();
  const pending = dashboard.getServicePlacement();
  let done = false;
  void pending.then(() => (done = true));
  await vi.advanceTimersByTimeAsync(ms);
  expect(done).toBe(true);
  return pending;
}

describe("service placement", () => {
  it("does not wait for a hanging Proxmox: without an earlier answer every service stays unplaced", async () => {
    fake.overview = never;
    const placement = await placementWithin(dashboard.PLACEMENT_WAIT_MS);
    expect(placement.unplacedServices.map((service) => service.key)).toEqual(["sonarr"]);
    expect(placement.servicesByGuest.size).toBe(0);
  });

  it("places services by the last answer while Proxmox is slow", async () => {
    fake.overview = async () => ok;
    expect((await dashboard.getServicePlacement()).unplacedServices).toEqual([]);

    fake.overview = never;
    const placement = await placementWithin(dashboard.PLACEMENT_WAIT_MS);
    expect(placement.unplacedServices).toEqual([]);
    expect([...placement.servicesByGuest.keys()]).toEqual(["pve/100"]);
  });

  it("keeps services in the Services card once Proxmox answered with an error", async () => {
    fake.overview = async () => ({ status: "error", message: "Proxmox down" });
    expect((await dashboard.getServicePlacement()).unplacedServices).toHaveLength(1);
    // Still hanging afterwards: the last answer is the error.
    fake.overview = never;
    expect((await placementWithin(dashboard.PLACEMENT_WAIT_MS)).unplacedServices).toHaveLength(1);
  });

  it("gives the Proxmox card the full answer, however long it takes", async () => {
    vi.useFakeTimers();
    fake.overview = () => new Promise((resolve) => setTimeout(() => resolve({ status: "error", message: "timeout" }), 5_000));
    const layout = dashboard.getDashboardLayout();
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await layout).proxmox).toEqual({ status: "error", message: "timeout" });
  });
});
