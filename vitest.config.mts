import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside Next's server build; tests are server code.
      "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["./tests/support/setup.ts"],
    // Separate processes: modules read env and the database at import time,
    // and some tests change the working directory (not allowed in threads).
    pool: "forks",
    testTimeout: 20_000,
  },
});
