import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import selfsigned from "selfsigned";

// Small helpers for tests that need a database or a fake service.

export async function migratedDb() {
  const { runMigrations } = await import("@/db/migrate");
  runMigrations();
  return (await import("@/db")).db;
}

type Handler = (request: http.IncomingMessage, body: string, response: http.ServerResponse) => void;

function withBody(handler: Handler): http.RequestListener {
  return async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    handler(request, body, response);
  };
}

export function json(response: http.ServerResponse, body: unknown, status = 200, statusText?: string) {
  response.writeHead(status, statusText, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

// Fake HTTP service on a random free port.
export async function startHttp(handler: Handler) {
  const server = http.createServer(withBody(handler));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

// Throwaway self-signed certificate, generated per test run so no private
// key is ever committed.
export async function certificate(commonName = "localhost") {
  const generated = await selfsigned.generate([{ name: "commonName", value: commonName }], { notAfterDate: new Date(Date.now() + 86_400_000), keySize: 2048 });
  return { key: generated.private, cert: generated.cert };
}

// Fake HTTPS service; swap() replaces the certificate and drops open
// connections, like a service restarting with a new certificate.
export async function startHttps(handler: Handler, initial?: { key: string; cert: string }) {
  const server = https.createServer(initial ?? (await certificate()), withBody(handler));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `https://localhost:${port}`,
    port,
    // Waits a moment, as a restarting service would: the client must notice
    // the dropped connection before its next request.
    async swap(next: { key: string; cert: string }) {
      server.setSecureContext(next);
      server.closeAllConnections();
      await new Promise((resolve) => setTimeout(resolve, 150));
    },
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
