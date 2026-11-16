import "server-only";
import { z } from "zod";
import { cacheFor } from "../cache";
import type { HttpClient } from "../http";
import { responseSchema } from "./schemas";

// Backup status from Proxmox, readable with the read-only token:
//   - newest backup per guest: the backup files on every backup storage
//     (local, NFS/SMB on the NAS, Proxmox Backup Server)
//   - the latest finished backup job ("vzdump" task) per node
// Listing backup storages can be slow, so callers cache the result.

const storagesSchema = z.array(
  z.object({
    storage: z.string(),
    active: z.union([z.number(), z.boolean()]).optional(),
  }),
);

const contentSchema = z.array(
  z.object({
    volid: z.string(),
    vmid: z.coerce.number().optional(),
    ctime: z.number().optional(), // seconds
  }),
);

const tasksSchema = z.array(
  z.object({
    node: z.string(),
    type: z.string(),
    status: z.string().optional(), // missing while running
    starttime: z.number(),
    endtime: z.number().optional(),
  }),
);

export type BackupJob = { node: string; ok: boolean; status: string; endedAt: number };

export type BackupInfo = {
  // vmid -> time of the newest backup (ms)
  lastBackup: Record<number, number>;
  // Storages that hold backups, for the setup check.
  storages: string[];
  // Storages whose listing failed (offline NAS, timeout). Their backups are
  // missing above, so a guest may look older than it is.
  failedStorages: string[];
  // Latest finished backup job per node.
  jobs: BackupJob[];
};

async function get<T extends z.ZodType>(client: HttpClient, path: string, schema: T): Promise<z.infer<T>> {
  return schema.parse((await client.get(path, responseSchema)).data);
}

export async function fetchBackupInfo(client: HttpClient, nodes: string[]): Promise<BackupInfo> {
  const lastBackup: Record<number, number> = {};
  const storages = new Set<string>();
  const failedStorages = new Set<string>();

  // All storages in parallel; one slow or failing storage (an offline NAS
  // share, a large PBS datastore) does not lose the others.
  await Promise.all(
    nodes.map(async (node) => {
      const nodeStorages = await get(client, `nodes/${encodeURIComponent(node)}/storage?content=backup`, storagesSchema);
      await Promise.all(
        nodeStorages.map(async ({ storage, active }) => {
          if (active === 0 || active === false) return;
          storages.add(storage);
          try {
            const items = await get(
              client,
              `nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content?content=backup`,
              contentSchema,
            );
            // Shared storages show up on every node: max() makes repeats harmless.
            for (const item of items) {
              if (item.vmid === undefined || item.ctime === undefined) continue;
              lastBackup[item.vmid] = Math.max(lastBackup[item.vmid] ?? 0, item.ctime * 1000);
            }
          } catch {
            failedStorages.add(storage);
          }
        }),
      );
    }),
  );

  // "OK" and "WARNINGS: n" (e.g. a guest skipped) count as done; anything
  // else, like "job errors", is a failed job.
  const latest = new Map<string, BackupJob>();
  for (const task of await get(client, "cluster/tasks", tasksSchema)) {
    if (task.type !== "vzdump" || task.endtime === undefined || task.status === undefined) continue;
    const endedAt = task.endtime * 1000;
    if ((latest.get(task.node)?.endedAt ?? 0) >= endedAt) continue;
    latest.set(task.node, {
      node: task.node,
      ok: task.status === "OK" || task.status.startsWith("WARNINGS"),
      status: task.status,
      endedAt,
    });
  }

  return {
    lastBackup,
    storages: [...storages].sort(),
    failedStorages: [...failedStorages].sort(),
    jobs: [...latest.values()],
  };
}

// Backups are guarded by the token's rights and slow to list, so they are
// fetched at most every 10 minutes, a failure is not retried for 3 minutes,
// and the overview never waits long for them: it shows the last known
// result while a slow listing finishes in the background. The last result
// is only shown while it is younger than two cache periods; after that a
// failing listing leaves no backup data (null) rather than old data.
export const BACKUP_CACHE_MS = 10 * 60_000;
export const BACKUP_WAIT_MS = 1_500;
export const BACKUP_RETRY_MS = 3 * 60_000;
export const BACKUP_STALE_MS = 2 * BACKUP_CACHE_MS;

export function createBackupReader(
  fetchInfo: (nodes: string[]) => Promise<BackupInfo>,
): (nodes: string[]) => Promise<BackupInfo | null> {
  const cached = cacheFor(BACKUP_CACHE_MS, fetchInfo);
  let failedAt: number | undefined;
  let last: { info: BackupInfo; fetchedAt: number } | undefined;
  const known = () => (last && Date.now() - last.fetchedAt < BACKUP_STALE_MS ? last.info : null);

  return async (nodes) => {
    if (failedAt !== undefined && Date.now() - failedAt < BACKUP_RETRY_MS) return known();
    const pending = cached(nodes).then(
      (info) => {
        // The cache hands out the same result for 10 minutes: keep the time
        // it was fetched, not the time it was read.
        if (last?.info !== info) last = { info, fetchedAt: Date.now() };
        failedAt = undefined;
        return info;
      },
      () => {
        failedAt = Date.now();
        return known();
      },
    );
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<"waiting">((resolve) => {
      timer = setTimeout(() => resolve("waiting"), BACKUP_WAIT_MS);
    });
    const result = await Promise.race([pending, waited]);
    clearTimeout(timer);
    return result === "waiting" ? known() : result;
  };
}
