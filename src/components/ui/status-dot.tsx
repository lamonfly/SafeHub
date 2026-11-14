// Small status indicator. Color is never the only signal: pass a label for
// screen readers and tooltips.
const tones = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  neutral: "bg-outline",
} as const;

export type StatusTone = keyof typeof tones;

export function StatusDot({ tone, label, className = "" }: { tone: StatusTone; label: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block size-2.5 shrink-0 rounded-full ${tones[tone]} ${className}`}
    />
  );
}
