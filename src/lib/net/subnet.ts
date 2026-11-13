import { networkInterfaces } from "node:os";
import { isPrivateIPv4 } from "./ip";

// Largest range one scan may cover (/22 = 1024 addresses).
export const MIN_PREFIX = 22;

function ipToInt(ip: string): number {
  return ip.split(".").reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0;
}

function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

export type Cidr = { network: string; prefix: number };

export function parseCidr(value: string): Cidr | null {
  const match = value.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match) return null;
  const prefix = Number(match[2]);
  if (prefix > 32 || !isPrivateIPv4(match[1])) return null;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return { network: intToIp(ipToInt(match[1]) & mask), prefix };
}

// Host addresses in the range (network and broadcast excluded for /30 and larger).
export function hostsInCidr({ network, prefix }: Cidr): string[] {
  const start = ipToInt(network);
  const size = 2 ** (32 - prefix);
  if (size <= 2) return Array.from({ length: size }, (_, i) => intToIp(start + i));
  return Array.from({ length: size - 2 }, (_, i) => intToIp(start + i + 1));
}

export function cidrContains({ network, prefix }: Cidr, ip: string): boolean {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToInt(ip) & mask) >>> 0 === ipToInt(network);
}

// The server's own private IPv4 subnets, e.g. ["192.168.0.0/24"].
// Wider subnets are narrowed to the /24 around the server's address.
export function localSubnets(): string[] {
  const subnets = new Set<string>();
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal || !isPrivateIPv4(address.address)) continue;
      const prefix = Math.max(Number(address.cidr?.split("/")[1] ?? 24), 24);
      const cidr = parseCidr(`${address.address}/${prefix}`);
      if (cidr) subnets.add(`${cidr.network}/${cidr.prefix}`);
    }
  }
  return [...subnets];
}
