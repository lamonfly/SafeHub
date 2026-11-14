"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";

type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
};

// M3 basic dialog used instead of window.confirm():
//   const [confirm, dialog] = useConfirm();
//   if (await confirm({ title: "Reboot?", confirmLabel: "Reboot" })) ...
//   return <>{dialog} ...</>;
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const ref = useRef<HTMLDialogElement>(null);
  const resolve = useRef<((confirmed: boolean) => void) | null>(null);
  const [options, setOptions] = useState<ConfirmOptions>();

  useEffect(() => {
    if (options && !ref.current?.open) ref.current?.showModal();
  }, [options]);

  const confirm = useCallback((next: ConfirmOptions) => {
    resolve.current?.(false);
    setOptions(next);
    return new Promise<boolean>((done) => {
      resolve.current = done;
    });
  }, []);

  function finish(confirmed: boolean) {
    resolve.current?.(confirmed);
    resolve.current = null;
    ref.current?.close();
  }

  const dialog = (
    <dialog
      ref={ref}
      onClose={() => finish(false)}
      onClick={(event) => {
        // Tap on the backdrop cancels, as in M3.
        if (event.target === ref.current) finish(false);
      }}
      className="m-auto w-[calc(100%-48px)] max-w-md rounded-[28px] bg-surface-container-high p-6 text-on-surface shadow-elevation-3"
    >
      {options && (
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl leading-8">{options.title}</h2>
          {options.message && <div className="text-sm text-on-surface-variant">{options.message}</div>}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button variant="text" onClick={() => finish(false)}>
              Cancel
            </Button>
            <Button
              variant="text"
              className={options.danger ? "text-error hover:bg-error/8" : ""}
              onClick={() => finish(true)}
              autoFocus
            >
              {options.confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );

  return [confirm, dialog];
}
