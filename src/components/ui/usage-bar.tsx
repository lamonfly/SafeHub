// M3 linear progress indicator used as a usage meter (CPU, RAM, disks).
// The track color follows the level: primary, warning at 75 %, error at 90 %.
export function UsageBar({ label, percent, detail }: { label: string; percent: number; detail?: string }) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const [bar, track] =
    clamped >= 90
      ? ["bg-error", "bg-error-container"]
      : clamped >= 75
        ? ["bg-warning", "bg-warning-container"]
        : ["bg-primary", "bg-primary-container"];

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex justify-between gap-2">
        <span className="truncate text-on-surface">{label}</span>
        <span className="shrink-0 text-on-surface-variant tabular-nums">
          {detail ? `${detail} · ` : ""}
          {Math.round(clamped)}%
        </span>
      </div>
      <div
        className={`flex h-1 gap-1 overflow-hidden rounded-full ${track}`}
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
