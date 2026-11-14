import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatPercent, formatUptime } from "./format";

describe("formatBytes", () => {
  it("uses binary units with one decimal while it adds information", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(8.5 * 1024 ** 3)).toBe("8.5 GiB");
    expect(formatBytes(570 * 1024 ** 3)).toBe("570 GiB");
    expect(formatBytes(14.5 * 1024 ** 4)).toBe("14.5 TiB");
  });
});

describe("formatPercent", () => {
  it("rounds a fraction to a whole percentage", () => {
    expect(formatPercent(0.184)).toBe("18%");
  });
});

describe("formatUptime", () => {
  it("shows the two largest units", () => {
    expect(formatUptime(0)).toBe("—");
    expect(formatUptime(45 * 60)).toBe("45m");
    expect(formatUptime(3 * 3600 + 5 * 60)).toBe("3h 5m");
    expect(formatUptime(22 * 86_400 + 2 * 3600)).toBe("22d 2h");
  });
});

describe("formatDuration", () => {
  it("is never below a minute and grows into hours and days", () => {
    expect(formatDuration(5_000)).toBe("1 min");
    expect(formatDuration(47 * 60_000)).toBe("47 min");
    expect(formatDuration((3 * 60 + 5) * 60_000)).toBe("3 h 5 min");
    expect(formatDuration((2 * 24 + 4) * 3_600_000)).toBe("2 d 4 h");
  });
});
