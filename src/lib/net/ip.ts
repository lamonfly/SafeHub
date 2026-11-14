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
