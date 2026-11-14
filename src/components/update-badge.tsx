import { getUpdateStatus } from "@/lib/update";

// Small header badge when GitHub has a newer version than this build.
export async function UpdateBadge() {
  const update = await getUpdateStatus();
  if (!update.available) return null;

  return (
    <a
      href={update.url}
      target="_blank"
      rel="noreferrer"
      title="Update with: docker compose up -d --build"
      className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-700 hover:underline dark:text-yellow-300"
    >
      Update available
    </a>
  );
}
