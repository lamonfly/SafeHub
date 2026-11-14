// Small trend line (last 24 hours) drawn as plain SVG on the server: no
// chart library, nothing extra for phones to load. Values are 0-100.
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const width = 100;
  const height = 24;
  const x = (index: number) => (index / (values.length - 1)) * width;
  const y = (value: number) => height - (Math.min(Math.max(value, 0), 100) / 100) * height;
  const line = values.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}, last 24 hours`}
      className="h-6 w-full text-primary"
    >
      <polygon points={`0,${height} ${line} ${width},${height}`} className="fill-primary/12" />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}
