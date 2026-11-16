import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { LocalTime } from "@/components/ui/local-time";
import { notificationsPausedUntil } from "@/lib/alerts/store";

// Settings > Notifications: says so while notifications are paused.
export function NotificationPauseNote() {
  const until = notificationsPausedUntil();
  if (!until) return null;
  return (
    <Banner tone="info">
      Notifications are paused until <LocalTime value={until.getTime()} />.{" "}
      <Link href="/alerts" className="underline">
        Resume on the Alerts page
      </Link>
    </Banner>
  );
}
