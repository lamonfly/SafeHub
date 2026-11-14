"use client";

import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Point } from "@/lib/metrics/store";

// Average as a filled area, peak as a thin line. Colors come from the M3
// tokens, so the chart follows light and dark mode.
export function HistoryChart({ points, longRange }: { points: Point[]; longRange: boolean }) {
  if (points.length < 2) {
    return <p className="py-8 text-center text-sm text-on-surface-variant">Not enough data yet. Check back in a few minutes.</p>;
  }

  const tick = (ts: number) =>
    longRange
      ? new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" })
      : new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="h-52 w-full sm:h-64">
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--md-outline-variant)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={tick}
            tick={{ fill: "var(--md-on-surface-variant)", fontSize: 12 }}
            stroke="var(--md-outline-variant)"
            minTickGap={40}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(value: number) => `${value}%`}
            tick={{ fill: "var(--md-on-surface-variant)", fontSize: 12 }}
            stroke="var(--md-outline-variant)"
            width={48}
          />
          <Tooltip
            labelFormatter={(ts) => new Date(Number(ts)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            formatter={(value, name) => [`${Math.round(Number(value))}%`, name === "avg" ? "Average" : "Peak"]}
            contentStyle={{
              background: "var(--md-surface-container-high)",
              border: "none",
              borderRadius: 12,
              color: "var(--md-on-surface)",
              boxShadow: "var(--shadow-elevation-2)",
            }}
          />
          <Area
            type="monotone"
            dataKey="avg"
            stroke="var(--md-primary)"
            strokeWidth={2}
            fill="var(--md-primary)"
            fillOpacity={0.15}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="max"
            stroke="var(--md-outline)"
            strokeWidth={1}
            strokeDasharray="4 3"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
