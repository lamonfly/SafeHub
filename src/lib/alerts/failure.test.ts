import { describe, expect, it } from "vitest";
import { describeFailure, failureAlert } from "./failure";

const reason = (message: string) => describeFailure({ message }).reason;

describe("failure causes", () => {
  it("are read from the adapters' error texts", () => {
    expect(reason("Sonarr 401 Unauthorized")).toBe("login rejected");
    expect(reason("Seerr 403 Forbidden")).toBe("login rejected");
    expect(reason("Synology login failed: wrong account or password. Next attempt in 5 min.")).toBe("login rejected");
    expect(reason("qBittorrent rejected the username or password.")).toBe("login rejected");
    expect(reason("qBittorrent has banned SafeHub's IP after too many failed logins.")).toBe("login rejected");
    expect(reason("Gluetun refused the request (401). Give SafeHub an API key role.")).toBe("login rejected");
    expect(reason("Unexpected response format (details in server log).")).toBe("unexpected response (API changed?)");
    expect(reason("Jellyfin answered with a web page instead of API data. Check the URL.")).toBe("wrong URL");
    expect(reason("VPN is stopped.")).toBe("VPN not running");
    expect(reason("Request timed out.")).toBe("unreachable");
    expect(reason("fetch failed: connect ECONNREFUSED 10.0.0.5:8989")).toBe("unreachable");
    expect(reason("Sonarr 500 Internal Server Error")).toBe("unreachable");
  });

  it("prefer a changed certificate over the text", () => {
    expect(
      describeFailure({ message: "The certificate changed.", certificateChanged: { pinId: "proxmox@pve:8006", fingerprint: "AB" } }).reason,
    ).toBe("certificate changed");
  });

  it("make the alert text", () => {
    expect(failureAlert("Sonarr", 3)).toEqual({ title: "Sonarr: unreachable", message: "No answer for 3+ minutes." });
    expect(failureAlert("Gluetun", 3, { reason: "VPN not running", detail: "VPN is stopped." })).toEqual({
      title: "Gluetun: VPN not running",
      message: "For 3+ minutes. VPN is stopped.",
    });
    expect(failureAlert("Sonarr", 3, { reason: "unreachable", detail: "fetch failed: connect ECONNREFUSED" }).message).toBe(
      "No answer for 3+ minutes. fetch failed: connect ECONNREFUSED.",
    );
  });
});
