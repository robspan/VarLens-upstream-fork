# VarLens — web build container.
#
# Multi-stage:
#   1. builder — installs deps, runs `npm run build:web` to produce
#      out/web/server.cjs, then trims node_modules to production-only.
#   2. runtime — minimal image carrying the bundle plus the production
#      modules that the bundle keeps external (fastify, pg,
#      better-sqlite3-multiple-ciphers, @node-rs/argon2, nanoid).
#
# Node version matches .nvmrc; Debian (bookworm-slim) is chosen over Alpine
# because better-sqlite3-multiple-ciphers ships glibc prebuilds. Switching
# to Alpine would require an in-image rebuild step.
#
# Internal port is fixed at 8080. Operators that need a different external
# port should remap via Compose `ports:`/Caddy upstream config rather than
# overriding VARLENS_WEB_PORT inside the container — EXPOSE and HEALTHCHECK
# are pinned to 8080 here.

# ---- Stage 1: builder -----------------------------------------------------
FROM node:24.14.1-bookworm-slim AS builder

WORKDIR /app

# Native deps for any optional rebuilds.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Skip the repo's own postinstall (it runs `@electron/rebuild` for the
# desktop ABI, which is wrong for the web container) but explicitly rebuild
# the native modules we actually need so prebuild-install fetches their
# .node binaries for system Node 24's ABI.
RUN npm ci --ignore-scripts \
 && npm rebuild better-sqlite3-multiple-ciphers @node-rs/argon2

COPY . .
RUN npm run build:web

# Reduce to production deps only.
RUN npm prune --omit=dev --ignore-scripts

# Verify what actually ships: bundle resolves AND the native bindings
# load AND actually invoke their hot path against the post-prune
# node_modules tree. This is the same set the runtime stage will copy,
# so a passing smoke here is binding. @node-rs/argon2 dispatches to
# platform-specific .node files via optional dependencies — only an
# actual `hash()` call exercises the dlopen path that prune could
# theoretically misresolve.
RUN node -e "(async () => { \
    require('./out/web/server.cjs'); \
    const Database = require('better-sqlite3-multiple-ciphers'); \
    new Database(':memory:').prepare('SELECT 1').get(); \
    const argon2 = require('@node-rs/argon2'); \
    await argon2.hash('smoke'); \
    console.log('post-prune bundle + native bindings ok'); \
  })().catch((e) => { console.error(e); process.exit(1); })"

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:24.14.1-bookworm-slim AS runtime

ENV NODE_ENV=production \
    VARLENS_WEB_PORT=8080 \
    VARLENS_LOG_LEVEL=info

# VARLENS_DB_PATH is intentionally NOT defaulted here. The fail-loud
# contract requires the operator to set it explicitly so that a missing
# volume mount does not silently land on a writable container layer that
# evaporates on `docker rm`. The IaC compose template sets this via
# `compose/.env` (DB_PATH=/data/varlens.db).

WORKDIR /app

# tini: PID 1 init that forwards signals and reaps zombies. Cheap insurance
# for any future subprocess (workers, native helpers) and the standard
# Docker-best-practice posture.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini wget ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Drop to a non-root user. /data is the persistent volume mount.
RUN groupadd --system --gid 1001 varlens \
 && useradd --system --uid 1001 --gid varlens --home /app --shell /usr/sbin/nologin varlens \
 && mkdir -p /data \
 && chown varlens:varlens /data /app

COPY --from=builder --chown=varlens:varlens /app/out/web ./out/web
COPY --from=builder --chown=varlens:varlens /app/node_modules ./node_modules
COPY --from=builder --chown=varlens:varlens /app/package.json ./package.json

USER varlens

EXPOSE 8080
VOLUME ["/data"]

# Self-describing liveness — Compose / IaC do not have to re-encode the
# probe. Tied to the pinned internal port (see header).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --quiet --spider http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "out/web/server.cjs"]
