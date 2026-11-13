import { isIPv4 } from "node:net";

function ipv4Octets(ip: string): number[] | null {
  return isIPv4(ip) ? ip.split(".").map(Number) : null;
}

// RFC 1918 private ranges: 10/8, 172.16/12, 192.168/16.
export function isPrivateIPv4(ip: string): boolean {
  const octets = ipv4Octets(ip);
  if (!octets) return false;
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// Valid Wake on LAN target: the limited broadcast or a private address
// (usually the subnet broadcast, e.g. 192.168.1.255).
export function isAllowedBroadcast(ip: string): boolean {
  return ip === "255.255.255.255" || isPrivateIPv4(ip);
}

// Plain hostname such as "nas" or "pve.lan" (no scheme, port or path).
export function isHostname(value: string): boolean {
  return (
    value.length <= 253 &&
    /^(?=.*[a-zA-Z])[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
      value,
    )
  );
}
