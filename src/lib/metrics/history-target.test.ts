import { describe, expect, it } from "vitest";
import { historyPath, parseHistoryTarget } from "./history-target";

describe("history paths", () => {
  it("parse machines and containers", () => {
    expect(parseHistoryTarget(["synology"])).toEqual({ kind: "synology" });
    expect(parseHistoryTarget(["node", "pve"])).toEqual({ kind: "node", node: "pve" });
    expect(parseHistoryTarget(["guest", "pve", "101"])).toEqual({ kind: "guest", node: "pve", vmid: 101 });
    expect(parseHistoryTarget(["docker", "immich_server"])).toEqual({ kind: "docker", name: "immich_server" });
    expect(parseHistoryTarget(["docker", "servarr-sonarr-1"])).toEqual({ kind: "docker", name: "servarr-sonarr-1" });
  });

  it("reject anything else", () => {
    for (const segments of [
      [],
      ["bogus"],
      ["synology", "extra"],
      ["node"],
      ["guest", "pve", "abc"],
      ["guest", "pve"],
      ["docker"],
      ["docker", "a", "b"],
      ["docker", "../etc"],
      ["docker", "-flag"],
      ["docker", "name with space"],
      ["docker", "x:y"],
      ["node", "a/b"],
    ]) {
      expect(parseHistoryTarget(segments), segments.join("/")).toBeNull();
    }
  });

  it("round-trip through the link", () => {
    const target = { kind: "docker", name: "immich.ml" } as const;
    const path = historyPath(target);
    expect(path).toBe("/history/docker/immich.ml");
    expect(parseHistoryTarget(path.split("/").slice(2).map(decodeURIComponent))).toEqual(target);
  });
});
