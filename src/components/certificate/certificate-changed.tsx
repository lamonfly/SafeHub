"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
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
  const [confirm, dialog] = useConfirm();

  async function accept() {
    const confirmed = await confirm({
      title: "Accept the new certificate?",
      message:
        "Only do this if you renewed or replaced the certificate. If you did not, something else may be answering at this address.",
      confirmLabel: "Accept",
      danger: true,
    });
    if (!confirmed) return;
    setError(undefined);
    startTransition(async () => setError((await acceptCertificateAction(pinId, fingerprint)).error));
  }

  return (
    <div role="alert" className="flex flex-col gap-3 rounded-lg bg-warning-container p-4 text-sm text-on-warning-container">
      <p>{message}</p>
      <p className="font-mono text-xs break-all opacity-80">New SHA-256: {fingerprint}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outlined" disabled={pending} onClick={accept}>
          {pending ? "Saving…" : "Accept new certificate"}
        </Button>
        {error && <span className="text-xs text-error">{error}</span>}
      </div>
      {dialog}
    </div>
  );
}
