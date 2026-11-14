"use client";

import { useState, useTransition } from "react";
import { acceptCertificateAction } from "./actions";

// Shown in place of a card's content when a pinned certificate changed.
export function CertificateChanged({
  message,
  pinId,
  fingerprint,
}: {
  message: string;
  pinId: string;
  fingerprint: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function accept() {
    const question =
      "Accept the new certificate? Only do this if you renewed or replaced it. " +
      "If you did not, something else may be answering at this address.";
    if (!window.confirm(question)) return;
    setError(undefined);
    startTransition(async () => setError((await acceptCertificateAction(pinId, fingerprint)).error));
  }

  return (
    <div role="alert" className="flex flex-col gap-2 text-sm">
      <p className="text-yellow-600 dark:text-yellow-400">{message}</p>
      <p className="font-mono text-xs break-all text-foreground/60">New SHA-256: {fingerprint}</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={accept}
          className="rounded-md border border-foreground/20 px-2 py-1 text-xs disabled:opacity-50"
        >
          {pending ? "Saving…" : "Accept new certificate"}
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  );
}
