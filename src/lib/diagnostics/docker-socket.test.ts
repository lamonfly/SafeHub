import { chmodSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "../../../tests/support/helpers";

// Unix permissions only: not on Windows, and root may use any socket.
const skip = process.platform === "win32" || process.getuid?.() === 0;
const socketPath = join(tmpdir(), `safehub-diagnostics-docker-${process.pid}.sock`);
let server: http.Server | undefined;
let diagnostics: typeof import("./run");

beforeAll(async () => {
  if (skip) return;
  server = http.createServer();
  await new Promise<void>((resolve) => server!.listen(socketPath, resolve));
  chmodSync(socketPath, 0o000); // like a socket of group 0 that SafeHub does not join
  process.env.DOCKER_SOCKET = socketPath;
  await migratedDb();
  diagnostics = await import("./run");
});
afterAll(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

describe.skipIf(skip)("setup check with a Docker socket SafeHub may not use", () => {
  it("says the socket is mounted but not accessible, and how to fix it", async () => {
    const docker = (await diagnostics.runDiagnostics()).find((section) => section.title === "Docker");
    expect(docker?.checks).toEqual([
      expect.objectContaining({ label: "Socket", status: "warn", detail: expect.stringContaining("chgrp docker") }),
    ]);
  });
});
