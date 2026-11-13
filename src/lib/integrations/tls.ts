import "server-only";
import { readFileSync } from "node:fs";
import { Agent } from "undici";

// Builds a per-integration HTTPS agent. Home lab services often use
// self-signed certificates; trust them per service, never app-wide.
//   caCertPath:       trust this CA (preferred, keeps verification on)
//   allowSelfSigned:  skip verification for this service only
export function createTlsAgent(options: {
  caCertPath?: string;
  allowSelfSigned: boolean;
}): Agent | undefined {
  if (options.caCertPath) {
    return new Agent({ connect: { ca: readFileSync(options.caCertPath) } });
  }
  if (options.allowSelfSigned) {
    return new Agent({ connect: { rejectUnauthorized: false } });
  }
  return undefined;
}
