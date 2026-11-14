// Integration settings editable on the /settings page. Each key is also an
// environment variable; a value set in compose.yaml / .env wins and shows as
// locked. Core settings (login, database) and CA paths stay env-only.

export type FieldType = "url" | "text" | "secret" | "flag";

export type SettingField = {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
};

export type SettingGroup = {
  id: string;
  title: string;
  help?: string;
  // Set for apps that auto-setup can find in ./appdata.
  discoverable?: "sonarr" | "radarr" | "prowlarr" | "bazarr" | "seerr";
  fields: SettingField[];
};

const urlAndKey = (prefix: string, port: number, keyHelp: string): SettingField[] => [
  { key: `${prefix}_URL`, label: "URL", type: "url", placeholder: `http://192.168.1.20:${port}` },
  { key: `${prefix}_API_KEY`, label: `API key (${keyHelp})`, type: "secret" },
];

export const settingGroups: SettingGroup[] = [
  {
    id: "proxmox",
    title: "Proxmox",
    help: "API token: Datacenter > Permissions > API Tokens, or use “Connect with password” below.",
    fields: [
      { key: "PROXMOX_URL", label: "URL", type: "url", placeholder: "https://192.168.1.10:8006" },
      { key: "PROXMOX_TOKEN_ID", label: "Token ID", type: "text", placeholder: "safehub@pve!safehub" },
      { key: "PROXMOX_TOKEN_SECRET", label: "Token secret", type: "secret" },
      { key: "PROXMOX_ALLOW_SELF_SIGNED", label: "Skip certificate checks", type: "flag" },
    ],
  },
  {
    id: "synology",
    title: "Synology",
    help: "Use a dedicated DSM user in the administrators group, with 2-factor authentication off.",
    fields: [
      { key: "SYNOLOGY_URL", label: "URL", type: "url", placeholder: "https://192.168.1.11:5001" },
      { key: "SYNOLOGY_USERNAME", label: "Username", type: "text" },
      { key: "SYNOLOGY_PASSWORD", label: "Password", type: "secret" },
      { key: "SYNOLOGY_ALLOW_SELF_SIGNED", label: "Skip certificate checks", type: "flag" },
    ],
  },
  { id: "sonarr", title: "Sonarr", discoverable: "sonarr", fields: urlAndKey("SONARR", 8989, "Settings > General") },
  { id: "radarr", title: "Radarr", discoverable: "radarr", fields: urlAndKey("RADARR", 7878, "Settings > General") },
  { id: "prowlarr", title: "Prowlarr", discoverable: "prowlarr", fields: urlAndKey("PROWLARR", 9696, "Settings > General") },
  { id: "bazarr", title: "Bazarr", discoverable: "bazarr", fields: urlAndKey("BAZARR", 6767, "Settings > General") },
  { id: "seerr", title: "Seerr", discoverable: "seerr", fields: urlAndKey("SEERR", 5055, "Settings > General") },
  { id: "jellyfin", title: "Jellyfin", fields: urlAndKey("JELLYFIN", 8096, "Dashboard > API Keys") },
  { id: "immich", title: "Immich", fields: urlAndKey("IMMICH", 2283, "Account Settings > API Keys, admin for stats") },
  {
    id: "updates",
    title: "Updates",
    help: "SafeHub checks GitHub once a week and shows a badge when a newer version exists. This is its only outgoing request of its own.",
    fields: [{ key: "DISABLE_UPDATE_CHECK", label: "Don't check for updates", type: "flag" }],
  },
];

export const settingFields = new Map(
  settingGroups.flatMap((group) => group.fields.map((field) => [field.key, field] as const)),
);
