import "server-only";
import { fetch } from "undici";
import { z } from "zod";
import { getFlag } from "@/lib/settings/store";

// Update notice: compares when this copy was built (set in next.config.ts)
// with the latest commit on GitHub's main branch. This is SafeHub's only
// outgoing request of its own; DISABLE_UPDATE_CHECK turns it off.

export const REPOSITORY = "lamonfly/SafeHub";
const CHECK_EVERY_MS = 7 * 24 * 60 * 60_000; // once a week
const RETRY_AFTER_FAILURE_MS = 60 * 60_000;

const commitSchema = z.object({
  html_url: z.url(),
  commit: z.object({ committer: z.object({ date: z.string() }) }),
});

export type UpdateStatus = { available: boolean; url?: string };

let last: { checkedAt: number; status: UpdateStatus; failed: boolean } | undefined;
let pending: Promise<UpdateStatus> | undefined;

async function check(): Promise<UpdateStatus> {
  const builtAt = Date.parse(process.env.SAFEHUB_BUILT_AT ?? "");
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/commits/main`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "SafeHub" },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`GitHub ${response.status}`);
  const latest = commitSchema.parse(await response.json());
  // A minute of slack for commits made right before the build.
  const newer = Date.parse(latest.commit.committer.date) > builtAt + 60_000;
  return { available: Number.isFinite(builtAt) && newer, url: `https://github.com/${REPOSITORY}/commits/main` };
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  if (getFlag("DISABLE_UPDATE_CHECK")) return { available: false };

  const age = last ? Date.now() - last.checkedAt : Infinity;
  if (last && age < (last.failed ? RETRY_AFTER_FAILURE_MS : CHECK_EVERY_MS)) return last.status;

  pending ??= check()
    .then((status) => {
      last = { checkedAt: Date.now(), status, failed: false };
      return status;
    })
    .catch(() => {
      // Offline or rate limited: stay quiet and try again later.
      last = { checkedAt: Date.now(), status: last?.status ?? { available: false }, failed: true };
      return last.status;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}
