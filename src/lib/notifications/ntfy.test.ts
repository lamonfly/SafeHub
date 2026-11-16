import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { json, migratedDb, startHttp } from "../../../tests/support/helpers";
import type { AlertEvent } from "@/lib/alerts/rules";

// Fake ntfy server that records every published message.
type Published = { topic: string; title: string; message: string; priority: number; tags: string[]; click?: string; auth?: string };
const published: Published[] = [];
let server: Awaited<ReturnType<typeof startHttp>>;
let ntfy: typeof import("./ntfy");
let store: typeof import("@/lib/settings/store");
let alerts: typeof import("@/lib/alerts/store");
let db: Awaited<ReturnType<typeof migratedDb>>;
let schema: typeof import("@/db/schema");

beforeAll(async () => {
  server = await startHttp((request, body, response) => {
    if (request.method === "GET" && request.url === "/v1/health") return json(response, { healthy: true });
    if (request.method !== "POST" || request.url !== "/") return json(response, { error: "wrong endpoint" }, 404);
    if (JSON.parse(body).topic === "forbidden") return json(response, { error: "unauthorized" }, 403, "Forbidden");
    published.push({ ...JSON.parse(body), auth: request.headers.authorization });
    json(response, { id: "x" });
  });
  process.env.BETTER_AUTH_URL = "https://safehub.example.lan";
  db = await migratedDb();
  store = await import("@/lib/settings/store");
  alerts = await import("@/lib/alerts/store");
  schema = await import("@/db/schema");
  ntfy = await import("./ntfy");
});
afterAll(() => server.close());
beforeEach(() => {
  published.length = 0;
});

const now = Date.UTC(2026, 10, 14, 12, 0, 0);
const event = (type: AlertEvent["type"], severity: AlertEvent["severity"], title: string, mutedUntil: Date | null = null): AlertEvent => ({
  type,
  key: title,
  mutedUntil,
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

  it("stop sending once the round is no longer wanted", async () => {
    let calls = 0;
    await ntfy.notify(
      [event("opened", "critical", "First"), event("opened", "critical", "Second"), event("opened", "critical", "Third")],
      now,
      () => ++calls <= 1, // given up after the first push
    );
    expect(published.map((item) => item.title)).toEqual(["First"]);
  });

  it("can be limited to critical alerts", async () => {
    store.saveSettings({ NTFY_CRITICAL_ONLY: "true" });
    await ntfy.notify([event("opened", "warning", "Node pve: CPU high"), event("opened", "critical", "Proxmox: unreachable")], now);
    expect(published.map((item) => item.title)).toEqual(["Proxmox: unreachable"]);
    store.saveSettings({ NTFY_CRITICAL_ONLY: null });
  });

  it("skip muted alerts, also their escalation and resolution, until the mute ends", async () => {
    const muted = new Date(now + 3_600_000);
    await ntfy.notify(
      [
        event("escalated", "critical", "Synology /volume1: almost full", muted),
        event("resolved", "warning", "Sonarr: unreachable", muted),
        event("opened", "warning", "Node pve: CPU high"),
        event("resolved", "warning", "Radarr: unreachable", new Date(now - 1)),
      ],
      now,
    );
    expect(published.map((item) => item.title)).toEqual(["Node pve: CPU high", "Resolved: Radarr: unreachable"]);
  });

  it("send nothing at all while paused for maintenance", async () => {
    alerts.pauseNotifications("1h", now);
    expect(alerts.notificationsPausedUntil(now)?.getTime()).toBe(now + 3_600_000);
    await ntfy.notify([event("opened", "critical", "Proxmox: unreachable"), event("resolved", "warning", "Sonarr: unreachable")], now);
    expect(published).toHaveLength(0);
    // Over after the hour, or when cancelled.
    expect(alerts.notificationsPausedUntil(now + 3_600_000)).toBeNull();
    alerts.pauseNotifications("off");
    await ntfy.notify([event("opened", "critical", "Proxmox: unreachable")], now);
    expect(published).toHaveLength(1);
  });

  it("mute only open alerts, for a while or until resolved", () => {
    const [open, closed] = db
      .insert(schema.alert)
      .values([
        { key: "a", severity: "warning", title: "A", message: "", startedAt: new Date(now) },
        { key: "b", severity: "warning", title: "B", message: "", startedAt: new Date(now), endedAt: new Date(now) },
      ])
      .returning()
      .all();
    expect(alerts.muteAlert(open.id, "8h", now)).toBe(true);
    const mutedUntil = () => alerts.listAlerts().find((item) => item.id === open.id)!.mutedUntil;
    expect(mutedUntil()?.getTime()).toBe(now + 8 * 3_600_000);
    expect(alerts.isMuted(mutedUntil(), now)).toBe(true);
    expect(alerts.muteAlert(open.id, "resolved", now)).toBe(true);
    expect(alerts.isMutedUntilResolved(mutedUntil())).toBe(true);
    expect(alerts.muteAlert(open.id, "off", now)).toBe(true);
    expect(mutedUntil()).toBeNull();
    expect(alerts.muteAlert(closed.id, "1h", now)).toBe(false);
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
