"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Copies the setup check report (contains no keys) for sharing.
export function CopyReport({ report }: { report: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard needs HTTPS or localhost; the text below can be selected instead.
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="tonal" onClick={copy}>
          {copied ? "Copied" : "Copy report"}
        </Button>
        <span className="text-xs text-on-surface-variant">Contains addresses and versions, never keys or passwords.</span>
      </div>
      <pre className="max-h-80 overflow-auto rounded-lg bg-surface-container-highest p-3 font-mono text-xs whitespace-pre-wrap text-on-surface">
        {report}
      </pre>
    </div>
  );
}
