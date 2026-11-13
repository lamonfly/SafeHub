// Horizontal bar for CPU, RAM and disk usage. Turns yellow at 75%, red at 90%.
export function UsageBar({ label, percent, detail }: { label: string; percent: number; detail?: string }) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const color = clamped >= 90 ? "bg-red-500" : clamped >= 75 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex justify-between gap-2">
        <span>{label}</span>
        <span className="text-foreground/70 tabular-nums">
          {detail ? `${detail} · ` : ""}
          {Math.round(clamped)}%
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
