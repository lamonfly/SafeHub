# syntax=docker/dockerfile:1

# Debian (glibc) base: better-sqlite3 ships prebuilt binaries for it.
# Pinned for reproducible builds; bump deliberately.
FROM node:24.15.0-bookworm-slim AS base
WORKDIR /app

# Install dependencies. Build tools are only a fallback in case
# better-sqlite3 has no prebuilt binary for this CPU and must compile.
FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholders so env validation passes while Next collects page data.
# Real values come from the .env file at runtime; nothing here is kept.
RUN BETTER_AUTH_SECRET=build-only-placeholder-not-used-at-runtime \
    BETTER_AUTH_URL=http://localhost:3000 \
    DATABASE_PATH=/tmp/build.db \
    NEXT_TELEMETRY_DISABLED=1 \
    npm run build

FROM base AS runner
# iproute2: `ip neigh` gives the scanner ARP entry states (stale vs. live).
RUN apt-get update \
  && apt-get install -y --no-install-recommends iproute2 \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# DATABASE_PATH defaults to ./data/safehub.db, relative to /app (the working
# directory), so the same relative paths work here and in development.

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Migrations run on startup from ./drizzle.
COPY --from=build /app/drizzle ./drizzle
# Turbopack links external packages as .next/node_modules/<name>-<hash>.
# Repoint them relative to /app/node_modules so they survive the copy out of
# .next/standalone, then fail the build if any link is still broken.
RUN if [ -d .next/node_modules ]; then \
      cd .next/node_modules \
      && for link in *; do \
           [ -L "$link" ] || continue; \
           target="$(readlink "$link")"; \
           ln -sfn "../../node_modules/${target##*/node_modules/}" "$link"; \
         done \
      && if find . -xtype l | grep -q .; then \
           echo "Broken links in .next/node_modules:"; find . -xtype l; exit 1; \
         fi; \
    fi
RUN mkdir -p /app/data /app/certs

# The entrypoint fixes /app/data ownership, then drops to PUID/PGID (default
# 1000) with setpriv. The app itself never runs as root: TCP scans, Wake on
# LAN broadcasts and reading the ARP table need no extra capabilities.
COPY --from=build /app/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && command -v setpriv
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
