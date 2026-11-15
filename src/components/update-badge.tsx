import { getUpdateStatus } from "@/lib/update";

// M3 assist chip style badge when GitHub has a newer version than this build.
export async function UpdateBadge() {
  const update = await getUpdateStatus();
  if (!update.available) return null;

  return (
    <a
      href={update.url}
      target="_blank"
      rel="noreferrer"
      title="Update with: docker compose pull && docker compose up -d"
      // after: extends the 32 px chip to a 48 px tap area.
      className="relative inline-flex h-8 shrink-0 items-center rounded-lg after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] bg-tertiary-container px-3 text-xs font-medium text-on-tertiary-container hover:shadow-elevation-1"
    >
      Update
      <span className="hidden sm:inline">&nbsp;available</span>
    </a>
  );
}
