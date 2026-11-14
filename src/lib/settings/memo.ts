import "server-only";
import { settingsVersion } from "./store";

// Builds a value from the current settings and rebuilds it only after
// settings were saved, so clients follow changes made on /settings.
export function perSettings<T>(build: () => T): () => T {
  let builtFor = -1;
  let value: T;
  return () => {
    if (builtFor !== settingsVersion()) {
      value = build();
      builtFor = settingsVersion();
    }
    return value;
  };
}
