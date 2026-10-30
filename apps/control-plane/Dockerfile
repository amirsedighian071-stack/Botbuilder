# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/platform-adapters/package.json packages/platform-adapters/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/bot-templates/package.json packages/bot-templates/package.json
COPY apps/control-plane/package.json apps/control-plane/package.json
COPY apps/cloudflare-worker/package.json apps/cloudflare-worker/package.json

RUN npm ci --omit=dev=false --workspaces --include-workspace-root

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm install --no-audit --no-fund typescript@5.7.2 tsx@4.19.2 esbuild@0.24.2 --no-save \
  && node scripts/build.mjs

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ARG INSTALL_FFMPEG=false
RUN if [ "$INSTALL_FFMPEG" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg && \
      rm -rf /var/lib/apt/lists/*; \
    fi

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATABASE_DRIVER=postgres \
    MEDIA_DIR=/app/.data/media

RUN groupadd --system --gid 1001 botforge \
  && useradd --system --uid 1001 --gid botforge --create-home botforge \
  && mkdir -p /app/.data/media \
  && chown -R botforge:botforge /app/.data

COPY --from=build --chown=botforge:botforge /app/package.json /app/package-lock.json ./
COPY --from=build --chown=botforge:botforge /app/node_modules ./node_modules
COPY --from=build --chown=botforge:botforge /app/dist ./dist
COPY --from=build --chown=botforge:botforge /app/packages ./packages
COPY --from=build --chown=botforge:botforge /app/scripts ./scripts

USER botforge
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/control-plane/main.js"]
