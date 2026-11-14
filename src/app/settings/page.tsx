import { AppHeader } from "@/components/app-header";
import { GroupForm, type FieldState } from "@/components/settings/group-form";
import { ProxmoxConnectForm } from "@/components/settings/proxmox-connect-form";
import { discovered } from "@/lib/integrations/discovery";
import { settingGroups } from "@/lib/settings/definitions";
import { getSetting, settingSource } from "@/lib/settings/store";
import { requireSession } from "@/lib/session";

export default async function SettingsPage() {
  const { user } = await requireSession();

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <AppHeader userName={user.name} />
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-foreground/70">
          Saved here, encrypted in SafeHub&apos;s database. Values set in <code>compose.yaml</code> or{" "}
          <code>.env</code> win and are shown as locked.
        </p>
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
          <section key={group.id} className="flex flex-col gap-3 rounded-lg border border-foreground/15 p-4">
            <div>
              <h2 className="text-lg font-semibold">{group.title}</h2>
              {group.help && <p className="text-sm text-foreground/70">{group.help}</p>}
              {usingFound && (
                <p className="text-sm text-green-600 dark:text-green-400">
                  Set up automatically from <code>./appdata/{found.folder}</code> ({found.url}). Fill in
                  fields only to override.
                </p>
              )}
            </div>
            <GroupForm groupId={group.id} fields={fields} />
            {group.id === "proxmox" && <ProxmoxConnectForm defaultUrl={getSetting("PROXMOX_URL")} />}
          </section>
        );
      })}
    </main>
  );
}
