import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { HttpClient } from "../http";
import { BACKUP_RETRY_MS, BACKUP_WAIT_MS, createBackupReader, fetchBackupInfo, type BackupInfo } from "./backups";

// Answers like the Proxmox API ({ data }), by path.
function fakeClient(responses: Record<string, unknown>): HttpClient & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    baseUrl: new URL("https://pve.test:8006/api2/json/"),
    async get<T extends z.ZodType>(path: string, schema: T) {
      paths.push(path);
      if (!(path in responses)) throw new Error(`unexpected ${path}`);
      return schema.parse({ data: responses[path] });
    },
    async post() {
      throw new Error("read only");
    },
  };
}

describe("fetchBackupInfo", () => {
  it("finds the newest backup per guest across storages and the latest job per node", async () => {
    const client = fakeClient({
      "nodes/pve/storage?content=backup": [
        { storage: "local", active: 1 },
        { storage: "nas", active: 1 },
        { storage: "offline", active: 0 },
      ],
      "nodes/pve/storage/local/content?content=backup": [
        { volid: "local:backup/vzdump-lxc-101-a.tar.zst", vmid: 101, ctime: 1_000 },
        { volid: "local:backup/vzdump-lxc-101-b.tar.zst", vmid: 101, ctime: 3_000 },
      ],
      "nodes/pve/storage/nas/content?content=backup": [
        { volid: "nas:backup/vzdump-qemu-102.vma.zst", vmid: "102", ctime: 2_000 },
        { volid: "nas:backup/vzdump-lxc-101-c.tar.zst", vmid: 101, ctime: 2_500 },
      ],
      "cluster/tasks": [
        { node: "pve", type: "vzdump", status: "job errors", starttime: 10, endtime: 20 },
        { node: "pve", type: "vzdump", status: "WARNINGS: 1", starttime: 30, endtime: 40 },
        { node: "pve", type: "vzdump", starttime: 50 }, // still running
        { node: "pve", type: "qmstart", status: "OK", starttime: 60, endtime: 61 },
      ],
    });

    const info = await fetchBackupInfo(client, ["pve"]);
    expect(info.lastBackup).toEqual({ 101: 3_000_000, 102: 2_000_000 });
    expect(info.storages).toEqual(["local", "nas"]);
    expect(info.failedStorages).toEqual([]);
    expect(info.jobs).toEqual([{ node: "pve", ok: true, status: "WARNINGS: 1", endedAt: 40_000 }]);
    expect(client.paths).not.toContain("nodes/pve/storage/offline/content?content=backup");
  });

  it("keeps the other storages when one fails", async () => {
    const client = fakeClient({
      "nodes/pve/storage?content=backup": [
        { storage: "local", active: 1 },
        { storage: "pbs", active: 1 }, // no answer: the fake throws
      ],
      "nodes/pve/storage/local/content?content=backup": [{ volid: "local:backup/a", vmid: 101, ctime: 1_000 }],
      "cluster/tasks": [],
    });
    const info = await fetchBackupInfo(client, ["pve"]);
    expect(info.lastBackup).toEqual({ 101: 1_000_000 });
    expect(info.storages).toEqual(["local", "pbs"]);
    expect(info.failedStorages).toEqual(["pbs"]);
  });

  it("reports a failed latest job", async () => {
    const client = fakeClient({
      "nodes/pve/storage?content=backup": [],
      "cluster/tasks": [
        { node: "pve", type: "vzdump", status: "OK", starttime: 10, endtime: 20 },
        { node: "pve", type: "vzdump", status: "job errors", starttime: 30, endtime: 40 },
      ],
    });
    const info = await fetchBackupInfo(client, ["pve"]);
    expect(info.jobs).toEqual([{ node: "pve", ok: false, status: "job errors", endedAt: 40_000 }]);
    expect(info.lastBackup).toEqual({});
  });
});

describe("createBackupReader", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const info = (vmid: number): BackupInfo => ({ lastBackup: { [vmid]: 1 }, storages: [], failedStorages: [], jobs: [] });
  const minutes = (count: number) => vi.advanceTimersByTimeAsync(count * 60_000);

  // A fetch the test answers by hand.
  function controlledFetch() {
    const calls: { resolve: (value: BackupInfo) => void; reject: (error: Error) => void }[] = [];
    const fetchInfo = vi.fn(
      () => new Promise<BackupInfo>((resolve, reject) => calls.push({ resolve, reject })),
    );
    return { fetchInfo, calls };
  }

  it("waits at most 1.5 s for a slow listing, then uses its result once it arrives", async () => {
    const { fetchInfo, calls } = controlledFetch();
    const read = createBackupReader(fetchInfo);

    const first = read(["pve"]);
    await vi.advanceTimersByTimeAsync(BACKUP_WAIT_MS);
    expect(await first).toBeNull();

    calls[0].resolve(info(101));
    await vi.advanceTimersByTimeAsync(0);
    // Cached: answered at once, no new listing.
    expect(await read(["pve"])).toEqual(info(101));
    expect(fetchInfo).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed listing for 3 minutes", async () => {
    const { fetchInfo, calls } = controlledFetch();
    const read = createBackupReader(fetchInfo);

    const first = read(["pve"]);
    calls[0].reject(new Error("permission denied"));
    expect(await first).toBeNull();

    await minutes(2);
    expect(await read(["pve"])).toBeNull();
    expect(fetchInfo).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(BACKUP_RETRY_MS - 2 * 60_000);
    const retried = read(["pve"]);
    expect(fetchInfo).toHaveBeenCalledTimes(2);
    calls[1].resolve(info(102));
    expect(await retried).toEqual(info(102));
  });

  it("keeps the last result while listings fail, but not once it is older than 20 minutes", async () => {
    const { fetchInfo, calls } = controlledFetch();
    const read = createBackupReader(fetchInfo);

    const first = read(["pve"]);
    calls[0].resolve(info(101));
    expect(await first).toEqual(info(101));

    // Cache expired after 10 min, the new listing fails: last result stays.
    await minutes(11);
    const failing = read(["pve"]);
    calls[1].reject(new Error("timeout"));
    expect(await failing).toEqual(info(101));

    // Still failing at 19 min: 19 min old, still shown.
    await minutes(8);
    const again = read(["pve"]);
    calls[2].reject(new Error("timeout"));
    expect(await again).toEqual(info(101));

    // 21 min old: no backup data rather than stale data.
    await minutes(2);
    expect(await read(["pve"])).toBeNull();
  });
});
