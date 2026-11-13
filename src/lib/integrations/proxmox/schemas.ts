import { z } from "zod";

// Proxmox wraps every response in { data: ... }.
export const responseSchema = z.object({ data: z.unknown() });

// Fields are missing for offline nodes and stopped guests, so default to 0.
const usage = {
  cpu: z.number().default(0), // fraction of maxcpu, 0..1
  maxcpu: z.number().default(0),
  mem: z.number().default(0), // bytes
  maxmem: z.number().default(0),
  uptime: z.number().default(0), // seconds
};

export const nodeSchema = z.object({
  node: z.string(),
  status: z.string(), // "online" | "offline" | "unknown"
  ...usage,
});

export const guestSchema = z.object({
  type: z.enum(["qemu", "lxc"]),
  vmid: z.number(),
  node: z.string(),
  name: z.string().optional(),
  status: z.string(), // "running" | "stopped" | "paused" | ...
  template: z.union([z.number(), z.boolean()]).optional(),
  ...usage,
});

export type ProxmoxNode = z.infer<typeof nodeSchema>;
export type ProxmoxGuest = z.infer<typeof guestSchema>;

export const guestActions = ["start", "shutdown", "reboot", "stop", "resume"] as const;
export type GuestAction = (typeof guestActions)[number];

// Input for control actions; values end up in the request URL.
export const guestActionInputSchema = z.object({
  node: z.string().regex(/^[a-zA-Z0-9-]+$/),
  type: z.enum(["qemu", "lxc"]),
  vmid: z.coerce.number().int().min(100).max(999_999_999),
  action: z.enum(guestActions),
});

export type GuestActionInput = z.infer<typeof guestActionInputSchema>;
