import "server-only";
import { Socket } from "node:net";

// open:     something accepted the connection
// closed:   the host answered with a reset (host is up, port is closed)
// filtered: no answer before the timeout, or the host is unreachable
export type PortState = "open" | "closed" | "filtered";

export function connectTcp(host: string, port: number, timeoutMs = 1_000): Promise<PortState> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (state: PortState) => {
      socket.destroy();
      resolve(state);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done("open"));
    socket.once("timeout", () => done("filtered"));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      done(error.code === "ECONNREFUSED" ? "closed" : "filtered"),
    );
    socket.connect(port, host);
  });
}

// Checks if a host is up with a TCP connect. A refused connection still
// proves the host answered, so it counts as online.
export async function probeTcp(host: string, port: number, timeoutMs = 1_000): Promise<boolean> {
  return (await connectTcp(host, port, timeoutMs)) !== "filtered";
}

// Runs fn over items with at most `limit` calls in flight.
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
