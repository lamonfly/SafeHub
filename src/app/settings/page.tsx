import Link from "next/link";
import { NotificationPauseNote } from "@/components/alerts/notification-pause-note";
import { AppHeader, PageBody } from "@/components/app-header";
import { GroupForm, type FieldState } from "@/components/settings/group-form";
import { NotificationTest } from "@/components/settings/notification-test";
import { ProxmoxConnectForm } from "@/components/settings/proxmox-connect-form";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { discovered } from "@/lib/integrations/discovery";
import { isNotificationsConfigured } from "@/lib/notifications/ntfy";
import { settingGroups } from "@/lib/settings/definitions";
import { getSetting, settingSource } from "@/lib/settings/store";
import { requireSession } from "@/lib/session";

export default async function SettingsPage() {
  const { user } = await requireSession();

  return (
    <>
      <AppHeader userName={user.name} />
      <PageBody>
        <div className="flex flex-col gap-1 px-1">
          <h1 className="text-[28px] leading-9 text-on-surface">Settings</h1>
          <p className="text-sm text-on-surface-variant">
            Saved encrypted in SafeHub&apos;s database. Values set in <code>compose.yaml</code> or <code>.env</code>{" "}
            win and are shown as locked.
          </p>
          <Link href="/diagnostics" className="mt-1 inline-flex min-h-12 items-center self-start text-sm font-medium text-primary hover:underline">
            Check setup →
          </Link>
        </div>

        {settingGroups.map((group) => {
          const fields: FieldState[] = group.fields.map((field) => ({
            key: field.key,
            label: field.label,
            type: field.type,
            placeholder: field.placeholder,
            source: settingSource(field.key),
            value: field.type === "secret" ? undefined : getSetting(field.key),
          }));
          const found = group.discoverable ? discovered[group.discoverable] : undefined;
          const usingFound = found && !fields.some((field) => field.source);

          return (
            <Card key={group.id} title={group.title} subtitle={group.help}>
              {usingFound && (
                <Banner tone="info">
                  Set up automatically from <code>./appdata/{found.folder}</code> ({found.url}). Fill in fields only
                  to override.
                </Banner>
              )}
              <GroupForm groupId={group.id} fields={fields} />
              {group.id === "proxmox" && <ProxmoxConnectForm defaultUrl={getSetting("PROXMOX_URL")} />}
              {group.id === "notifications" && <NotificationTest configured={isNotificationsConfigured()} />}
              {group.id === "notifications" && <NotificationPauseNote />}
            </Card>
          );
        })}
      </PageBody>
    </>
  );
}
