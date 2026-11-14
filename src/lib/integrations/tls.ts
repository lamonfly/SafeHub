import "server-only";
import { readFileSync } from "node:fs";
import { TLSSocket } from "node:tls";
import { eq } from "drizzle-orm";
import { Agent, buildConnector } from "undici";
import { db } from "@/db";
import { certPin } from "@/db/schema";
import { CertificateChangedError } from "./cert-error";

// Builds a per-integration HTTPS agent. Home lab services often use
// self-signed certificates; trust them per service, never app-wide.
//   caCertPath:       trust this CA (normal verification against it)
//   allowSelfSigned:  skip verification for this service only
//   neither (default): trust on first use. A certificate that passes normal
//     verification (public CA, matching name) is simply accepted. Otherwise
//     the first certificate seen is pinned by fingerprint, and later
//     connections must present the same one, like SSH host keys.
export function createTlsAgent(options: {
  pinName: string;
  caCertPath?: string;
  allowSelfSigned: boolean;
}): Agent {
  if (options.caCertPath) {
    return new Agent({ connect: { ca: readFileSync(options.caCertPath) } });
  }
  if (options.allowSelfSigned) {
    return new Agent({ connect: { rejectUnauthorized: false } });
  }
  return new Agent({ connect: pinningConnector(options.pinName) });
}

function pinningConnector(pinName: string): buildConnector.connector {
  // No session resumption: every connection must present its certificate.
  const connect = buildConnector({ rejectUnauthorized: false, maxCachedSessions: 0 });

  return (options, callback) =>
    connect(options, (error, socket) => {
      if (error) return callback(error, null);
      // Plain http, or a certificate that verifies normally: nothing to pin.
      if (!(socket instanceof TLSSocket) || socket.authorized) return callback(null, socket);

      const fingerprint = socket.getPeerCertificate().fingerprint256;
      const pinId = `${pinName}@${options.hostname}:${options.port || 443}`;
      const pinned = db.select().from(certPin).where(eq(certPin.id, pinId)).get();

      if (!pinned) {
        db.insert(certPin).values({ id: pinId, fingerprint }).onConflictDoNothing().run();
        return callback(null, socket);
      }
      if (pinned.fingerprint === fingerprint) return callback(null, socket);

      socket.destroy();
      callback(new CertificateChangedError(pinId, pinned.fingerprint, fingerprint), null);
    });
}

const fingerprintPattern = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

// Replaces a pin after the owner confirmed the new certificate (e.g. renewed).
export function acceptCertificate(pinId: string, fingerprint: string): boolean {
  if (!fingerprintPattern.test(fingerprint)) return false;
  const updated = db
    .update(certPin)
    .set({ fingerprint, pinnedAt: new Date() })
    .where(eq(certPin.id, pinId))
    .run();
  return updated.changes > 0;
}
