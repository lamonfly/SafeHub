"use client";

// Formats a time in the viewer's own time zone and language. The server runs
// in the container's zone (usually UTC), so it cannot do this itself.
export function LocalTime({ value, format = "datetime" }: { value: number; format?: "datetime" | "time" }) {
  const date = new Date(value);
  const text =
    format === "time"
      ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <time dateTime={date.toISOString()} suppressHydrationWarning>
      {text}
    </time>
  );
}
