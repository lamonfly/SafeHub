import { z } from "zod";
import { isAllowedBroadcast, isHostname, isPrivateIPv4 } from "@/lib/net/ip";

// Accepts aa:bb:cc:dd:ee:ff, aa-bb-cc-dd-ee-ff or aabbccddeeff;
// stores lowercase with colons.
export const macSchema = z
  .string()
  .trim()
  .regex(
    /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$|^[0-9a-fA-F]{12}$/,
    "Enter a MAC address like aa:bb:cc:dd:ee:ff.",
  )
  .transform((mac) =>
    mac
      .replace(/[:-]/g, "")
      .toLowerCase()
      .match(/.{2}/g)!
      .join(":"),
  );

const portSchema = z.coerce.number().int().min(1).max(65_535);

// Empty form fields become undefined.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" || value === null ? undefined : value), schema.optional());

export const wolDeviceInputSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name.").max(64),
    mac: macSchema,
    broadcast: z
      .string()
      .trim()
      .default("255.255.255.255")
      .refine(isAllowedBroadcast, "Broadcast must be 255.255.255.255 or a private address."),
    port: optional(portSchema).transform((port) => port ?? 9),
    host: optional(
      z
        .string()
        .trim()
        .refine(
          (host) => isPrivateIPv4(host) || isHostname(host),
          "Host must be a private IP or a hostname.",
        ),
    ),
    checkPort: optional(portSchema),
  })
  .refine((device) => !device.checkPort || device.host, {
    message: "Set a host to use the check port.",
    path: ["checkPort"],
  });

export type WolDeviceInput = z.infer<typeof wolDeviceInputSchema>;
