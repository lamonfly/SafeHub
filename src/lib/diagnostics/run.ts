import "server-only";
import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";
import { count, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { alert, metricSample } from "@/db/schema";
import { formatDuration } from "@/lib/format";
import { discovered } from "@/lib/integrations/discovery";
import { guestKey, placeServices } from "@/lib/integrations/placement";
import { backupMaxAgeDays, getProxmoxClient, getProxmoxOverview, isProxmoxConfigured } from "@/lib/integrations/proxmox";
import { responseSchema } from "@/lib/integrations/proxmox/schemas";
import { attempt } from "@/lib/integrations/result";
import { getServiceStatuses, hasConfiguredServices } from "@/lib/integrations/services";
import { getSynologyOverview, isSynologyConfigured } from "@/lib/integrations/synology";
import { checkNtfyServer } from "@/lib/notifications/ntfy";

// "Check setup": runs the real checks against the configured systems and
// describes what SafeHub sees, so problems on real hardware are easy to spot
// and to report. Never includes keys, tokens or passwords.

export type CheckStatus = "ok" | "warn" | "fail" | "info";
export type Check = { label: string; status: CheckStatus; detail: string };
export type Section = { title: string; checks: Check[] };

const ago = (time: number, now: number) => `${formatDuration(now - time)} ago`;

function safehubSection(now: number): Section {
  const builtAt = Date.parse(process.env.SAFEHUB_BUILT_AT ?? "");
  const lastSample = db.select({ ts: sql<number | null>`max(${metricSample.ts})` }).from(metricSample).get()?.ts ?? null;
  const open = db.select({ value: count() }).from(alert).where(isNull(alert.endedAt)).get()?.value ?? 0;
  const sampled = isSynologyConfigured() || isProxmoxConfigured() || hasConfiguredServices();
  return {
    title: "SafeHub",
    checks: [
      { label: "Build", status: "info", detail: Number.isFinite(builtAt) ? new Date(builtAt).toISOString() : "development" },
      lastSample === null && !sampled
        ? { label: "History", status: "info", detail: "Nothing to sample yet: add Proxmox, Synology or a service." }
        : lastSample === null
        ? { label: "History", status: "warn", detail: "No samples yet (the first one is taken within a minute of starting)." }
        : {
            label: "History",
            status: now - lastSample < 3 * 60_000 ? "ok" : "fail",
            detail: `Last sample ${ago(lastSample, now)}.`,
          },
      { label: "Open alerts", status: open > 0 ? "warn" : "ok", detail: String(open) },
    ],
  };
}

const permissionsSchema = z.record(z.string(), z.record(z.string(), z.union([z.number(), z.boolean()])));

async function proxmoxSection(now: number): Promise<Section | null> {
  const client = getProxmoxClient();
  if (!client) return null;
  const checks: Check[] = [];

  const version = await attempt(async () => z.object({ version: z.string() }).parse((await client.get("version", responseSchema)).data));
  checks.push(
    version.status === "ok"
      ? { label: "Connection", status: "ok", detail: `Proxmox VE ${version.data.version}` }
      : { label: "Connection", status: "fail", detail: version.status === "error" ? version.message : "" },
  );
  if (version.status !== "ok") return { title: "Proxmox", checks };

  // The token's rights on "/" decide which features work.
  const permissions = await attempt(async () => permissionsSchema.parse((await client.get("access/permissions", responseSchema)).data));
  if (permissions.status === "ok") {
    const root = permissions.data["/"] ?? {};
    const has = (privilege: string) => Boolean(root[privilege]);
    const right = (label: string, privileges: string[], missing: string, required = true): Check =>
      privileges.some(has)
        ? { label, status: "ok", detail: "yes" }
        : { label, status: required ? "fail" : "warn", detail: missing };
    checks.push(
      right("Read nodes and tasks", ["Sys.Audit"], "Missing Sys.Audit: give the token PVEAuditor on /."),
      right("Read guests and LXC addresses", ["VM.Audit"], "Missing VM.Audit: give the token PVEAuditor on /."),
      right("Read backups", ["Datastore.Audit"], "Missing Datastore.Audit: backup status stays hidden.", false),
      right("VM addresses (guest agent)", ["VM.GuestAgent.Audit", "VM.Monitor"], "Missing: VM addresses stay hidden (LXCs still work).", false),
      right("Start / stop buttons", ["VM.PowerMgmt"], "Missing VM.PowerMgmt (PVEVMUser): buttons will fail.", false),
    );
  } else {
    checks.push({ label: "Token rights", status: "warn", detail: permissions.status === "error" ? permissions.message : "" });
  }

  const overview = await getProxmoxOverview();
  if (overview.status !== "ok") {
    checks.push({ label: "Overview", status: "fail", detail: overview.status === "error" ? overview.message : "" });
    return { title: "Proxmox", checks };
  }
  const { nodes, guests, backups } = overview.data;
  checks.push({
    label: "Nodes",
    status: nodes.every((node) => node.status === "online") ? "ok" : "warn",
    detail: nodes.map((node) => `${node.node} (${node.status})`).join(", "),
  });

  for (const guest of guests.filter((item) => item.status === "running")) {
    const kind = guest.type === "qemu" ? "VM" : "LXC";
    const name = `${guest.name ?? guest.vmid} (${kind} ${guest.vmid})`;
    const parts = [
      guest.addresses.length ? `IP ${guest.addresses.join(", ")}` : kind === "VM" ? "no IP: is the QEMU guest agent installed and enabled?" : "no IP reported",
      guest.dockerNetworks.length ? `Docker networks ${guest.dockerNetworks.join(", ")}` : undefined,
    ];
    checks.push({ label: name, status: guest.addresses.length ? "ok" : "warn", detail: parts.filter(Boolean).join(" · ") });
  }
  const stopped = guests.filter((item) => item.status !== "running").length;
  if (stopped) checks.push({ label: "Not running", status: "info", detail: `${stopped} guests` });

  if (!backups) {
    checks.push({ label: "Backups", status: "warn", detail: "Could not read backup storages or tasks." });
  } else {
    const withBackup = guests.filter((guest) => typeof guest.backupAgeMs === "number");
    const overdue = guests.filter((guest) => guest.backupOverdue);
    checks.push({
      label: "Backups",
      status: overdue.length ? "warn" : "ok",
      detail: `Storages: ${backups.storages.join(", ") || "none"} · ${withBackup.length} of ${guests.length} guests have backups` +
        (backups.failedStorages.length ? ` · could not read: ${backups.failedStorages.join(", ")} (overdue check paused)` : "") +
        (overdue.length ? ` · overdue (> ${backupMaxAgeDays()} days): ${overdue.map((guest) => guest.name ?? guest.vmid).join(", ")}` : ""),
    });
    for (const job of backups.jobs) {
      checks.push({ label: `Last backup job on ${job.node}`, status: job.ok ? "ok" : "fail", detail: `${job.status}, ${ago(job.endedAt, now)}` });
    }
  }
  return { title: "Proxmox", checks };
}

async function synologySection(): Promise<Section | null> {
  if (!isSynologyConfigured()) return null;
  const result = await getSynologyOverview();
  if (result.status !== "ok") {
    return { title: "Synology", checks: [{ label: "Connection", status: "fail", detail: result.status === "error" ? result.message : "" }] };
  }
  const { model, firmware, volumes, disks } = result.data;
  return {
    title: "Synology",
    checks: [
      { label: "Connection", status: "ok", detail: [model, firmware].filter(Boolean).join(", ") || "connected" },
      { label: "Volumes", status: volumes.length ? "ok" : "warn", detail: volumes.map((volume) => `${volume.name} (${volume.status})`).join(", ") || "none found" },
      { label: "Disks", status: disks.length ? "ok" : "warn", detail: disks.map((disk) => `${disk.name} (${disk.status})`).join(", ") || "none found" },
    ],
  };
}

async function resolve(host: string): Promise<string[]> {
  if (isIPv4(host)) return [host];
  return lookup(host, { all: true, family: 4 }).then((results) => results.map((result) => result.address), () => []);
}

async function servicesSection(): Promise<Section | null> {
  if (!hasConfiguredServices()) return null;
  const statuses = await getServiceStatuses();
  const overview = await getProxmoxOverview();
  const guests = overview.status === "ok" ? overview.data.guests : [];
  const placed = await placeServices(guests, statuses);
  const guestOf = (key: string) => {
    for (const [guest, services] of placed) if (services.some((service) => service.key === key)) return guest;
    return undefined;
  };
  const guestName = (key: string) => guests.find((guest) => guestKey(guest) === key)?.name ?? key;

  const checks: Check[] = [];
  for (const service of statuses) {
    const ips = await resolve(service.host);
    const where = guestOf(service.key);
    const placement = where
      ? `under ${guestName(where)}`
      : guests.length
        ? `not placed (${service.host} → ${ips.join(", ") || "does not resolve"})`
        : undefined;
    checks.push({
      label: service.name,
      status: service.result.status === "ok" ? "ok" : "fail",
      detail: [
        service.result.status === "ok" ? `v${service.result.data.version ?? "?"}` : service.result.status === "error" ? service.result.message : "",
        `host ${service.host}`,
        placement,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return { title: "Services", checks };
}

async function setupSection(): Promise<Section> {
  const found = Object.entries(discovered);
  const ntfy = await checkNtfyServer();
  return {
    title: "Auto-setup and notifications",
    checks: [
      {
        label: "Auto-setup (./appdata)",
        status: "info",
        detail: found.length ? found.map(([app, item]) => `${app} → ${item.url}`).join(", ") : "nothing mounted",
      },
      ntfy
        ? {
            label: "Notifications",
            status: ntfy.ok ? "ok" : "fail",
            detail: `ntfy server ${new URL(ntfy.server).host} ${ntfy.ok ? "answers" : `does not answer: ${ntfy.detail}`} (topic set; use the test button in Settings to reach the phone)`,
          }
        : { label: "Notifications", status: "info", detail: "not set up" },
    ],
  };
}

export async function runDiagnostics(): Promise<Section[]> {
  const now = Date.now();
  const [proxmox, synology, services, setup] = await Promise.all([proxmoxSection(now), synologySection(), servicesSection(), setupSection()]);
  return [safehubSection(now), ...[proxmox, synology, services].filter((section): section is Section => section !== null), setup];
}

// Plain text for sharing: no keys, tokens or passwords are ever part of it.
export function diagnosticsReport(sections: Section[]): string {
  const marks: Record<CheckStatus, string> = { ok: "OK  ", warn: "WARN", fail: "FAIL", info: "info" };
  return sections
    .map((section) => [`## ${section.title}`, ...section.checks.map((check) => `[${marks[check.status]}] ${check.label}: ${check.detail}`)].join("\n"))
    .join("\n\n");
}
