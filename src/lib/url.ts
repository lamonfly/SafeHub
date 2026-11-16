import { z } from "zod";

// Addresses of services and of SafeHub itself: http or https only, and no
// user:password@ part (credentials belong in their own secret settings, where
// they are encrypted and never shown; in a URL they would end up in links,
// logs and the setup report).
export const httpUrl = z
  .url({ protocol: /^https?$/, error: "Must be an http:// or https:// address." })
  .refine((value) => {
    // Also runs after a failed URL check; that one already reports the error.
    if (!URL.canParse(value)) return true;
    const url = new URL(value);
    return url.username === "" && url.password === "";
  },"Must not contain a user name or password (user:password@).");
