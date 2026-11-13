import { z } from "zod";
import { isPrivateIPv4 } from "@/lib/net/ip";
import { parsePortList, topPorts } from "@/lib/net/ports";
import { MIN_PREFIX, parseCidr } from "@/lib/net/subnet";

export const discoveryInputSchema = z.object({
  cidr: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const cidr = parseCidr(value);
      if (!cidr) {
        ctx.addIssue({ code: "custom", message: "Enter a private range like 192.168.1.0/24." });
        return z.NEVER;
      }
      if (cidr.prefix < MIN_PREFIX) {
        ctx.addIssue({ code: "custom", message: `Range too large; use /${MIN_PREFIX} or smaller.` });
        return z.NEVER;
      }
      return cidr;
    }),
});

export const portScanInputSchema = z.object({
  ip: z.string().trim().refine(isPrivateIPv4, "Enter a private IPv4 address."),
  // Empty means the built-in top ports list.
  ports: z
    .string()
    .trim()
    .default("")
    .transform((value, ctx) => {
      if (value === "") return topPorts;
      const ports = parsePortList(value);
      if (!ports) {
        ctx.addIssue({ code: "custom", message: "Use ports like 22,80,8000-8100 (max 2048)." });
        return z.NEVER;
      }
      return ports;
    }),
});
