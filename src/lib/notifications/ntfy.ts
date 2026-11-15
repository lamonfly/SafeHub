import "server-only";
import { fetch } from "undici";
import type { AlertEvent } from "@/lib/alerts/rules";
import { env } from "@/lib/env";
import { formatDuration } from "@/lib/format";
import { getFlag, getSetting } from "@/lib/settings/store";

// Push notifications through ntfy (https://ntfy.sh or a self-hosted server).
// Opt-in: nothing is sent until a topic is set. Uses ntfy's JSON publishing
// so titles may contain any characters.

const DEFAULT_SERVER = "https://ntfy.sh";
const TIMEOUT_MS = 5_000;
// More events than this in one round become a single summary push.
const MAX_PER_ROUND = 4;

type Message = {
  title: string;
  message: string;
  priority: 1 | 2 | 3 | 4 | 5; // 5 = urgent, 3 = default
  tags: string[]; // ntfy shows these as emoji
};

function config() {
  const topic = getSetting("NTFY_TOPIC");
  if (!topic) return null;
  return {
    server: (getSetting("NTFY_URL") ?? DEFAULT_SERVER).replace(/\/+$/, ""),
    topic,
    token: getSetting("NTFY_TOKEN"),
    criticalOnly: getFlag("NTFY_CRITICAL_ONLY"),
  };
}

export function isNotificationsConfigured(): boolean {
  return config() !== null;
}

async function publish(message: Message): Promise<void> {
  const settings = config();
  if (!settings) throw new Error("No ntfy topic set.");
  const response = await fetch(settings.server, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
    },
    body: JSON.stringify({
      topic: settings.topic,
      ...message,
      // Tapping the notification opens the alert log, when SafeHub's address is known.
      ...(env.BETTER_AUTH_URL ? { click: new URL("/alerts", env.BETTER_AUTH_URL).href } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ntfy ${response.status} ${response.statusText} ${detail}`.trim());
  }
}

function toMessage(event: AlertEvent, now: number): Message {
  if (event.type === "resolved") {
    return {
      title: `Resolved: ${event.title}`,
      message: `Back to normal after ${formatDuration(now - event.startedAt.getTime())}.`,
      priority: 3,
      tags: ["white_check_mark"],
    };
  }
  const critical = event.severity === "critical";
  return {
    title: event.type === "escalated" ? `Now critical: ${event.title}` : event.title,
    message: event.message,
    priority: critical ? 5 : 4,
    tags: [critical ? "rotating_light" : "warning"],
  };
}

// Sends the events of one sampler round. Never throws: a failed push is
// logged and the alerts themselves are unaffected.
export async function notify(events: AlertEvent[], now = Date.now()): Promise<void> {
  const settings = config();
  if (!settings || events.length === 0) return;
  const wanted = settings.criticalOnly ? events.filter((event) => event.severity === "critical") : events;
  if (wanted.length === 0) return;

  const messages = wanted.slice(0, wanted.length > MAX_PER_ROUND ? MAX_PER_ROUND - 1 : MAX_PER_ROUND).map((event) => toMessage(event, now));
  if (wanted.length > MAX_PER_ROUND) {
    const rest = wanted.length - messages.length;
    messages.push({
      title: `${rest} more alert changes`,
      message: "Open SafeHub's Alerts page for the full list.",
      priority: wanted.slice(messages.length).some((event) => event.severity === "critical" && event.type !== "resolved") ? 5 : 3,
      tags: ["bell"],
    });
  }

  for (const message of messages) {
    try {
      await publish(message);
    } catch (error) {
      console.warn(`Notification failed: ${(error as Error).message}`);
    }
  }
}

// For the setup check: does the ntfy server answer? Sends nothing to the phone.
export async function checkNtfyServer(): Promise<{ server: string; ok: boolean; detail: string } | null> {
  const settings = config();
  if (!settings) return null;
  try {
    const response = await fetch(`${settings.server}/v1/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return { server: settings.server, ok: false, detail: `HTTP ${response.status} ${response.statusText}`.trim() };
    const body = (await response.json().catch(() => null)) as { healthy?: boolean } | null;
    return body?.healthy === true
      ? { server: settings.server, ok: true, detail: "answers" }
      : { server: settings.server, ok: false, detail: "answers, but not like an ntfy server" };
  } catch (error) {
    const cause = (error as Error & { cause?: Error }).cause;
    return { server: settings.server, ok: false, detail: cause?.message ?? (error as Error).message };
  }
}

// For the Settings page's test button.
export async function sendTestNotification(): Promise<void> {
  await publish({
    title: "SafeHub test",
    message: "Notifications work. Alerts will arrive here.",
    priority: 3,
    tags: ["bell"],
  });
}
