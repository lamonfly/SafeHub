// Host name of a Host header value; undefined when it is missing or malformed.
export function hostnameOf(host: string | null): string | undefined {
  if (!host) return undefined;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return undefined;
  }
}
