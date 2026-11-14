import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Files marked "use client" may only export React components (PascalCase),
// hooks (use*) and types. A plain helper exported from such a file cannot be
// called by server code: it crashes at render time, which typecheck and build
// do not catch (this happened with formatDuration).

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

const valueExport = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_]+)/gm;

describe('"use client" files', () => {
  it("export only components and hooks", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("src")) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/.test(source)) continue;
      for (const [, name] of source.matchAll(valueExport)) {
        if (!/^[A-Z]/.test(name) && !/^use[A-Z]/.test(name)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
