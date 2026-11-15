import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "../../../tests/support/helpers";

let diagnostics: typeof import("./run");

beforeAll(async () => {
  await migratedDb();
  diagnostics = await import("./run");
});

describe("setup check", () => {
  it("runs with nothing configured and writes a plain report", async () => {
    const sections = await diagnostics.runDiagnostics();
    expect(sections.map((section) => section.title)).toEqual(["SafeHub", "Auto-setup and notifications"]);
    const report = diagnostics.diagnosticsReport(sections);
    expect(report).toContain("## SafeHub");
    expect(report).toContain("[info] History: Nothing to sample yet");
    expect(report).toContain("[info] Notifications: not set up");
  });
});
