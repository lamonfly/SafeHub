// Thrown when a pinned certificate no longer matches (see tls.ts). Kept in its
// own file so result.ts can recognise it without importing the database.
export class CertificateChangedError extends Error {
  constructor(
    readonly pinId: string,
    readonly pinnedFingerprint: string,
    readonly presentedFingerprint: string,
  ) {
    super(`Certificate changed for ${pinId}`);
    this.name = "CertificateChangedError";
  }
}
