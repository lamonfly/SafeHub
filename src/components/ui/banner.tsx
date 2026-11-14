import type { ReactNode } from "react";

// Inline message on an M3 container color (error / warning / info).
const tones = {
  error: "bg-error-container text-on-error-container",
  warning: "bg-warning-container text-on-warning-container",
  info: "bg-secondary-container text-on-secondary-container",
} as const;

export function Banner({ tone, children }: { tone: keyof typeof tones; children: ReactNode }) {
  return (
    <div role={tone === "info" ? "status" : "alert"} className={`rounded-lg px-4 py-3 text-sm break-words ${tones[tone]}`}>
      {children}
    </div>
  );
}
