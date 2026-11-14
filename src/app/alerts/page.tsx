import { connection } from "next/server";
import { markAllReadAction } from "@/components/alerts/actions";
import { AlertList } from "@/components/alerts/alert-list";
import { AppHeader, PageBody } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { thresholds } from "@/lib/alerts/rules";
import { listAlerts, unreadCount } from "@/lib/alerts/store";
import { requireSession } from "@/lib/session";

export default async function AlertsPage() {
  const { user } = await requireSession();
  await connection();
  const alerts = listAlerts();
  const unread = unreadCount();
  // Server component, rendered once per request: the current time is wanted.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const { usage, volume } = thresholds;

  return (
    <>
      <AppHeader userName={user.name} />
      <PageBody>
        <div className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <h1 className="text-[28px] leading-9 text-on-surface">Alerts</h1>
            <p className="text-sm text-on-surface-variant">Problems from the last 90 days, newest first.</p>
          </div>
          {unread > 0 && (
            <form action={markAllReadAction}>
              <Button type="submit" variant="tonal">
                Mark all as read ({unread})
              </Button>
            </form>
          )}
        </div>
        <Card>
          {alerts.length > 0 ? (
            <AlertList alerts={alerts} now={now} />
          ) : (
            <p className="py-4 text-sm text-on-surface-variant">No alerts so far. All quiet.</p>
          )}
        </Card>
        <p className="px-1 text-xs text-on-surface-variant">
          Checked every minute: CPU or memory above {usage.open}% for {usage.minutes} minutes, volumes above{" "}
          {volume.warning}% (critical at {volume.critical}%), disks not healthy, and services or machines not
          answering for a few minutes.
        </p>
      </PageBody>
    </>
  );
}
