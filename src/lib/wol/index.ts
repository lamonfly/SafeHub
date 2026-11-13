import "server-only";
import { createSocket } from "node:dgram";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { wolDevice, type WolDevice } from "@/db/schema";
import { probeTcp } from "@/lib/net/probe";
import type { WolDeviceInput } from "./schemas";

const DEFAULT_CHECK_PORT = 22;

// Magic packet: 6 bytes of 0xFF, then the MAC address 16 times.
export function buildMagicPacket(mac: string): Buffer {
  const macBytes = Buffer.from(mac.replace(/:/g, ""), "hex");
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(macBytes)]);
}

// UDP is fire-and-forget, so send a few copies in case one is dropped.
export async function sendMagicPacket(
  device: Pick<WolDevice, "mac" | "broadcast" | "port">,
  copies = 3,
): Promise<void> {
  const packet = buildMagicPacket(device.mac);
  const socket = createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(() => {
        socket.setBroadcast(true);
        resolve();
      });
    });
    for (let i = 0; i < copies; i++) {
      await new Promise<void>((resolve, reject) =>
        socket.send(packet, device.port, device.broadcast, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
    }
  } finally {
    socket.close();
  }
}

export type WolDeviceStatus = WolDevice & { online: boolean | null };

export async function listDevices(): Promise<WolDevice[]> {
  return db.select().from(wolDevice).orderBy(asc(wolDevice.name));
}

// online is null when the device has no host to check.
export async function listDevicesWithStatus(): Promise<WolDeviceStatus[]> {
  const devices = await listDevices();
  return Promise.all(
    devices.map(async (device) => ({
      ...device,
      online: device.host
        ? await probeTcp(device.host, device.checkPort ?? DEFAULT_CHECK_PORT)
        : null,
    })),
  );
}

export async function getDevice(id: string): Promise<WolDevice | undefined> {
  const [device] = await db.select().from(wolDevice).where(eq(wolDevice.id, id));
  return device;
}

export async function addDevice(input: WolDeviceInput): Promise<void> {
  await db.insert(wolDevice).values(input);
}

export async function deleteDevice(id: string): Promise<void> {
  await db.delete(wolDevice).where(eq(wolDevice.id, id));
}
