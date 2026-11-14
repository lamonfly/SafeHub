import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { openAlerts } from "@/lib/alerts/store";
import { AlertList } from "./alert-list";

// Top of the dashboard while something is wrong; nothing otherwise.
export function OpenAlertsCard() {
  const alerts = openAlerts();
  if (alerts.length === 0) return null;
  const critical = alerts.some((item) => item.severity === "critical");
  // Server component, rendered once per request: the current time is wanted.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <section
      className={`flex flex-col gap-2 rounded-xl p-4 shadow-elevation-1 sm:p-6 ${
        critical ? "bg-error-container/60" : "bg-warning-container/60"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[22px] leading-7 text-on-surface">
          {alerts.length === 1 ? "1 problem" : `${alerts.length} problems`} right now
        </h2>
        <Link href="/alerts" className={buttonClass("text")}>
          All alerts
        </Link>
      </div>
      <AlertList alerts={alerts} now={now} />
    </section>
  );
}
