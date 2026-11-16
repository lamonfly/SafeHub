import { afterEach, describe, expect, it, vi } from "vitest";

// env.ts validates process.env when it is imported: re-import per case.
async function loadWith(value: string) {
  process.env.PROXMOX_BACKUP_MAX_AGE_DAYS = value;
  vi.resetModules();
  return import("./env");
}

async function loadWithUrl(value: string) {
  process.env.SONARR_URL = value;
  vi.resetModules();
  return import("./env");
}

afterEach(() => {
  delete process.env.PROXMOX_BACKUP_MAX_AGE_DAYS;
  delete process.env.SONARR_URL;
});

describe("env validation", () => {
  it("accepts a whole number of backup days", async () => {
    expect((await loadWith("7")).env.PROXMOX_BACKUP_MAX_AGE_DAYS).toBe("7");
    expect((await loadWith("30")).env.PROXMOX_BACKUP_MAX_AGE_DAYS).toBe("30");
  });

  it("refuses to start with an invalid number of backup days", async () => {
    await expect(loadWith("1d")).rejects.toThrow(/PROXMOX_BACKUP_MAX_AGE_DAYS/);
    await expect(loadWith("0")).rejects.toThrow(/PROXMOX_BACKUP_MAX_AGE_DAYS/);
  });

  it("accepts only http(s) service URLs without user:password@", async () => {
    expect((await loadWithUrl("http://sonarr:8989")).env.SONARR_URL).toBe("http://sonarr:8989");
    expect((await loadWithUrl("https://sonarr.lan/")).env.SONARR_URL).toBe("https://sonarr.lan/");
    for (const url of ["ftp://sonarr", "file:///etc/passwd", "javascript:alert(1)", "http://user:pass@sonarr:8989", "http://user@sonarr"]) {
      await expect(loadWithUrl(url)).rejects.toThrow(/SONARR_URL/);
    }
  });
});
