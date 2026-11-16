import { beforeAll, describe, expect, it, vi } from "vitest";
import { migratedDb } from "../../../tests/support/helpers";

// The Server Action without Next's request context: a signed-in session and
// refresh() are stubbed.
vi.mock("@/lib/session", () => ({ requireSession: async () => ({}) }));
vi.mock("next/cache", () => ({ refresh: () => undefined }));

// Proxmox wizard: a fake token, and a switch that makes saving fail.
const wizard = vi.hoisted(() => ({ failSave: false, removeNewToken: async () => {}, removedNew: 0 }));
vi.mock("@/lib/integrations/proxmox/connect", () => ({
  createProxmoxToken: async () => ({
    tokenId: "safehub@pve!safehub",
    secret: "new-secret",
    guestAgentAddresses: true,
    removeOldTokens: async () => {},
    removeNewToken: async () => {
      wizard.removedNew++;
      await wizard.removeNewToken();
    },
  }),
}));
vi.mock("@/lib/settings/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/settings/store")>();
  return {
    ...original,
    saveSettings: (changes: Parameters<typeof original.saveSettings>[0]) => {
      if (wizard.failSave && "PROXMOX_TOKEN_SECRET" in changes) throw new Error("disk full");
      return original.saveSettings(changes);
    },
  };
});

let actions: typeof import("./actions");
let store: typeof import("@/lib/settings/store");

beforeAll(async () => {
  await migratedDb();
  actions = await import("./actions");
  store = await import("@/lib/settings/store");
});

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("saving a settings group", () => {
  it("trims text fields but keeps secrets exactly as typed", async () => {
    const result = await actions.saveGroupAction(
      {},
      form({ group: "synology", SYNOLOGY_URL: "  https://nas.lan:5001 ", SYNOLOGY_USERNAME: " admin ", SYNOLOGY_PASSWORD: " pass word " }),
    );
    expect(result).toEqual({ message: "Saved." });
    expect(store.getSetting("SYNOLOGY_URL")).toBe("https://nas.lan:5001");
    expect(store.getSetting("SYNOLOGY_USERNAME")).toBe("admin");
    expect(store.getSetting("SYNOLOGY_PASSWORD")).toBe(" pass word ");
  });

  it("keeps the saved secret when its field is left empty", async () => {
    await actions.saveGroupAction({}, form({ group: "synology", SYNOLOGY_URL: "https://nas.lan:5001", SYNOLOGY_PASSWORD: "" }));
    expect(store.getSetting("SYNOLOGY_PASSWORD")).toBe(" pass word ");
  });

  it("keeps the saved secret when its field holds only spaces", async () => {
    await actions.saveGroupAction({}, form({ group: "synology", SYNOLOGY_URL: "https://nas.lan:5001", SYNOLOGY_PASSWORD: "   " }));
    expect(store.getSetting("SYNOLOGY_PASSWORD")).toBe(" pass word ");
  });
});

describe("Proxmox wizard", () => {
  const connectForm = () => form({ url: "https://pve.lan:8006", username: "root@pam", password: "rootpw" });

  it("saves the new token and keeps it", async () => {
    wizard.removedNew = 0;
    const result = await actions.connectProxmoxAction({}, connectForm());
    expect(result.message).toContain("Connected.");
    expect(store.getSetting("PROXMOX_TOKEN_SECRET")).toBe("new-secret");
    expect(wizard.removedNew).toBe(0);
  });

  it("removes the new token when saving it fails, and never logs the secret", async () => {
    wizard.failSave = true;
    wizard.removedNew = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    wizard.removeNewToken = async () => {
      throw new Error("Proxmox 500 down");
    };
    try {
      const result = await actions.connectProxmoxAction({}, connectForm());
      expect(result.error).toBeTruthy();
      expect(wizard.removedNew).toBe(1);
      // A failed removal is only logged.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("safehub@pve!safehub");
      expect(String(warn.mock.calls[0][0])).not.toContain("new-secret");
    } finally {
      wizard.failSave = false;
      wizard.removeNewToken = async () => {};
      warn.mockRestore();
    }
  });
});
