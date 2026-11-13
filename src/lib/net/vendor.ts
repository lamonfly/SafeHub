import "server-only";

let ouiTable: Record<string, string> | undefined;

// Looks up the manufacturer from the MAC prefix (IEEE OUI list).
export async function lookupVendor(mac: string): Promise<string | null> {
  // Locally administered bit: random MACs used by phones and VMs.
  if (parseInt(mac.slice(0, 2), 16) & 2) return "Private (randomized)";

  ouiTable ??= (await import("oui-data")).default as Record<string, string>;
  const entry = ouiTable[mac.replace(/:/g, "").slice(0, 6).toUpperCase()];
  return entry ? entry.split("\n")[0] : null;
}
