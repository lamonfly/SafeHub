"use client";

import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import type { ContainerAction, DockerContainer } from "@/lib/integrations/docker";
import { historyPath } from "@/lib/metrics/history-target";
import { dockerContainerAction } from "./actions";

function containerTone(container: DockerContainer): [StatusTone, string] {
  if (container.state === "running") {
    return container.status.includes("(unhealthy)")
      ? ["warning", `Unhealthy: ${container.status}`]
      : ["success", container.status || "Running"];
  }
  if (container.state === "restarting" || container.state === "dead") return ["error", container.status];
  return ["neutral", container.status || container.state];
}

const labels: Record<ContainerAction, string> = { start: "Start", stop: "Stop", restart: "Restart" };

// Start is harmless; stop and restart interrupt the app.
const confirmations: Partial<Record<ContainerAction, string>> = {
  stop: "Stops the container. Docker waits 10 seconds for it to exit, then kills it.",
  restart: "Stops and starts the container again. Running work is interrupted.",
};

// Chip for one container (styled like the service chips). Tapping it opens a
// dialog with its details, a link to its web page and its controls.
export function ContainerChip({ container, hostAddress }: { container: DockerContainer; hostAddress?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [confirm, confirmDialog] = useConfirm();
  const [tone, label] = containerTone(container);
  const running = container.state === "running";
  const actions: ContainerAction[] = container.self ? [] : running || container.state === "restarting" ? ["restart", "stop"] : ["start"];

  async function run(action: ContainerAction) {
    const message = confirmations[action];
    if (message) {
      dialogRef.current?.close();
      const confirmed = await confirm({
        title: `${labels[action]} ${container.name}?`,
        message,
        confirmLabel: labels[action],
        danger: action === "stop",
      });
      if (!confirmed) return;
    }
    setError(undefined);
    startTransition(async () => {
      const result = await dockerContainerAction({ id: container.id, action });
      setError(result.error);
      if (result.error) dialogRef.current?.showModal();
      else dialogRef.current?.close();
    });
  }

  return (
    <>
      {/* 32 px chip as in M3; the after: box extends the tap area to 48 px. */}
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        disabled={pending}
        className="relative inline-flex h-8 max-w-full items-center gap-2 rounded-lg after:absolute after:inset-x-0 after:top-1/2 after:h-12 after:-translate-y-1/2 after:content-[''] border border-outline-variant px-3 text-sm text-on-surface hover:bg-on-surface/8 disabled:opacity-40"
      >
        <StatusDot tone={tone} label={label} />
        <span className="truncate">{container.name}</span>
        {container.ports[0] !== undefined && (
          <span className="font-mono text-xs text-on-surface-variant">:{container.ports[0]}</span>
        )}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClick={(event) => {
          // Tap on the backdrop closes, as in M3.
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto w-[calc(100%-48px)] max-w-md rounded-[28px] bg-surface-container-high p-6 text-on-surface shadow-elevation-3"
      >
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <StatusDot tone={tone} label={label} />
            <h2 id={titleId} className="truncate text-2xl leading-8">
              {container.name}
            </h2>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-on-surface-variant">Status</dt>
            <dd>{container.status || container.state}</dd>
            <dt className="text-on-surface-variant">Image</dt>
            <dd className="font-mono text-xs break-all">{container.image}</dd>
            {container.project && (
              <>
                <dt className="text-on-surface-variant">Compose</dt>
                <dd>{container.project}</dd>
              </>
            )}
            {container.ports.length > 0 && (
              <>
                <dt className="text-on-surface-variant">Ports</dt>
                <dd className="flex flex-wrap gap-x-3">
                  {container.ports.map((port) =>
                    hostAddress && running ? (
                      <a
                        key={port}
                        href={`http://${hostAddress}:${port}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-primary underline"
                      >
                        {port}
                      </a>
                    ) : (
                      <span key={port} className="font-mono">
                        {port}
                      </span>
                    ),
                  )}
                </dd>
              </>
            )}
          </dl>
          {container.self && <p className="text-sm text-on-surface-variant">This is SafeHub itself.</p>}
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {actions.map((action) => (
              <Button
                key={action}
                variant={action === "stop" ? "danger" : action === "start" ? "tonal" : "outlined"}
                disabled={pending}
                onClick={() => run(action)}
              >
                {labels[action]}
              </Button>
            ))}
            {hostAddress && running && container.ports[0] !== undefined && (
              <a
                href={`http://${hostAddress}:${container.ports[0]}`}
                target="_blank"
                rel="noreferrer"
                className={buttonClass("filled")}
              >
                Open
              </a>
            )}
            <Link href={historyPath({ kind: "docker", name: container.name })} className={buttonClass("text")}>
              History
            </Link>
            <Button variant="text" onClick={() => dialogRef.current?.close()}>
              Close
            </Button>
          </div>
        </div>
      </dialog>
      {confirmDialog}
    </>
  );
}
