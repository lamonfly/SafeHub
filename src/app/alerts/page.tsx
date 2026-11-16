import { connection } from "next/server";
import { markAllReadAction } from "@/components/alerts/actions";
import { AlertList } from "@/components/alerts/alert-list";
import { NotificationPause } from "@/components/alerts/notification-pause";
import { AppHeader, PageBody } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { thresholds } from "@/lib/alerts/rules";
import { listAlerts, notificationsPausedUntil, unreadCount } from "@/lib/alerts/store";
import { isNotificationsConfigured } from "@/lib/notifications/ntfy";
import { requireSession } from "@/lib/session";

export default async function AlertsPage() {
  const { user } = await requireSession();
  await connection();
  const alerts = listAlerts();
  const unread = unreadCount();
  // Server component, rendered once per request: the current time is wanted.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const { usage, volume, crashLoop } = thresholds;
  const notifications = isNotificationsConfigured();
  const pausedUntil = notificationsPausedUntil(now)?.getTime() ?? null;

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
        {notifications && (
          <Card title="Notifications" subtitle={pausedUntil ? "Paused for maintenance" : "Sent to your phone through ntfy"}>
            <NotificationPause pausedUntil={pausedUntil} />
          </Card>
        )}
        <Card>
          {alerts.length > 0 ? (
            <AlertList alerts={alerts} now={now} muteControls={notifications} />
          ) : (
            <p className="py-4 text-sm text-on-surface-variant">No alerts so far. All quiet.</p>
          )}
        </Card>
        <p className="px-1 text-xs text-on-surface-variant">
          Checked every minute: CPU or memory above {usage.open}% for {usage.minutes} minutes, volumes above{" "}
          {volume.warning}% (critical at {volume.critical}%), disks or RAID volumes not healthy, services or machines
          not answering (or rejecting the login) for a few minutes, crashed or unhealthy containers, and containers
          restarted {crashLoop.restarts}+ times in 15 minutes. Muting an alert only silences its notifications.
        </p>
      </PageBody>
    </>
  );
}
