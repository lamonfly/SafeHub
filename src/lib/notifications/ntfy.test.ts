import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { json, migratedDb, startHttp } from "../../../tests/support/helpers";
import type { AlertEvent } from "@/lib/alerts/rules";

// Fake ntfy server that records every published message.
type Published = { topic: string; title: string; message: string; priority: number; tags: string[]; click?: string; auth?: string };
const published: Published[] = [];
let server: Awaited<ReturnType<typeof startHttp>>;
let ntfy: typeof import("./ntfy");
let store: typeof import("@/lib/settings/store");

beforeAll(async () => {
  server = await startHttp((request, body, response) => {
    if (request.method === "GET" && request.url === "/v1/health") return json(response, { healthy: true });
    if (request.method !== "POST" || request.url !== "/") return json(response, { error: "wrong endpoint" }, 404);
    if (JSON.parse(body).topic === "forbidden") return json(response, { error: "unauthorized" }, 403, "Forbidden");
    published.push({ ...JSON.parse(body), auth: request.headers.authorization });
    json(response, { id: "x" });
  });
  process.env.BETTER_AUTH_URL = "https://safehub.example.lan";
  await migratedDb();
  store = await import("@/lib/settings/store");
  ntfy = await import("./ntfy");
});
afterAll(() => server.close());
beforeEach(() => {
  published.length = 0;
});

const now = Date.UTC(2026, 10, 14, 12, 0, 0);
const event = (type: AlertEvent["type"], severity: AlertEvent["severity"], title: string): AlertEvent => ({
  type,
  severity,
  title,
  message: "Details.",
  startedAt: new Date(now - 47 * 60_000),
});

describe("ntfy notifications", () => {
  it("send nothing until a topic is set", async () => {
    expect(ntfy.isNotificationsConfigured()).toBe(false);
    await ntfy.notify([event("opened", "critical", "Synology Drive 3: warning")], now);
    expect(published).toHaveLength(0);
  });

  it("push opened, escalated and resolved alerts with fitting priority", async () => {
    store.saveSettings({ NTFY_URL: server.url, NTFY_TOPIC: "safehub-test", NTFY_TOKEN: "tk_secret" });
    await ntfy.notify(
      [
        event("opened", "critical", "Synology Drive 3: warning"),
        event("opened", "warning", "Node pve: CPU high"),
        event("escalated", "critical", "Synology /volume1: almost full"),
        event("resolved", "warning", "Sonarr: unreachable"),
      ],
      now,
    );
    expect(published.map(({ title, priority, tags }) => ({ title, priority, tag: tags[0] }))).toEqual([
      { title: "Synology Drive 3: warning", priority: 5, tag: "rotating_light" },
      { title: "Node pve: CPU high", priority: 4, tag: "warning" },
      { title: "Now critical: Synology /volume1: almost full", priority: 5, tag: "rotating_light" },
      { title: "Resolved: Sonarr: unreachable", priority: 3, tag: "white_check_mark" },
    ]);
    expect(published[3].message).toBe("Back to normal after 47 min.");
    expect(published.every((item) => item.topic === "safehub-test" && item.auth === "Bearer tk_secret")).toBe(true);
    expect(published[0].click).toBe("https://safehub.example.lan/alerts");
  });

  it("summarise a burst instead of flooding the phone", async () => {
    const burst = Array.from({ length: 9 }, (_, index) => event("opened", "critical", `Guest ${index}: unreachable`));
    await ntfy.notify(burst, now);
    expect(published).toHaveLength(4);
    expect(published[3]).toMatchObject({ title: "6 more alert changes", priority: 5 });
  });

  it("can be limited to critical alerts", async () => {
    store.saveSettings({ NTFY_CRITICAL_ONLY: "true" });
    await ntfy.notify([event("opened", "warning", "Node pve: CPU high"), event("opened", "critical", "Proxmox: unreachable")], now);
    expect(published.map((item) => item.title)).toEqual(["Proxmox: unreachable"]);
    store.saveSettings({ NTFY_CRITICAL_ONLY: null });
  });

  it("never throws on a failed push, but the test button reports it", async () => {
    store.saveSettings({ NTFY_TOPIC: "forbidden" });
    await expect(ntfy.notify([event("opened", "critical", "x")], now)).resolves.toBeUndefined();
    await expect(ntfy.sendTestNotification()).rejects.toThrow("ntfy 403 Forbidden");
  });

  it("checks that the server answers without sending anything", async () => {
    expect(await ntfy.checkNtfyServer()).toMatchObject({ ok: true, detail: "answers" });
    store.saveSettings({ NTFY_URL: "http://127.0.0.1:9" }); // nothing listens there
    expect(await ntfy.checkNtfyServer()).toMatchObject({ ok: false });
    store.saveSettings({ NTFY_URL: server.url });
    expect(published).toHaveLength(0);
  });
});
