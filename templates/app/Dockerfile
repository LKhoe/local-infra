# Next.js (output: "standalone") + Drizzle app image.
# Template: local-infra/templates/app/Dockerfile — see local-infra/DEPLOYING-APPS.md.
# Needs: next.config with output: "standalone", scripts/migrate.mjs, lib/db/migrations, an
# /api/health route, package-lock.json committed, and esbuild in devDependencies
# (npm i -D esbuild) to bundle the plain-.mjs entrypoint scripts.

# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files, then strip the version field so version bumps don't bust the npm ci cache
COPY package.json package-lock.json ./
RUN sed -i '3s/"version": "[^"]*"/"version": "0.0.0"/' package.json package-lock.json

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source files (overwrites package.json with the real version)
COPY . .

# Ensure public/ exists so the runner stage's COPY doesn't fail when the app has none
RUN mkdir -p public

# Build args for NEXT_PUBLIC_ vars (must be available at build time)
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# Build the application (output: "standalone" is set in next.config.ts)
RUN npm run build

# Bundle the plain-.mjs scripts the entrypoint runs (migrations, seeds) with their dependencies
# (drizzle-orm, pg, ...), so the runner needs no node_modules of its own beyond the standalone
# output's. pg-native is pg's optional native binding (not installed, pg falls back to JS); the
# banner gives bundled CommonJS dependencies a require(). Add every script's path to the list.
RUN npx esbuild scripts/migrate.mjs \
      --bundle --platform=node --format=esm --target=node24 --outdir=dist-scripts --out-extension:.js=.mjs \
      --external:pg-native \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

# Production stage
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Only if the app runs pg_dump itself (e.g. an in-app backup): match local-infra's PG_VERSION,
# an older pg_dump refuses a newer server.
# ARG PG_MAJOR=17
# RUN apk add --no-cache postgresql${PG_MAJOR}-client

# Don't run as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy only the necessary files for standalone mode
COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size: the standalone output carries only the
# node_modules the server uses (no `npm ci --omit=dev` here, it would add hundreds of MB).
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Only if the app uses sharp (next/image, uploads) and the standalone output lacks it. Check in the
# builder: `ls .next/standalone/node_modules/sharp .next/standalone/node_modules/@img`; when both
# exist (usual with Next 15+), leave this commented. The builder runs the same Alpine image and
# architecture, so these are the lockfile's exact versions and the matching libvips.
# COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp
# COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@img ./node_modules/@img

# Database migrations and the bundled scripts the entrypoint runs (no tsx/drizzle-kit, no node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/lib/db/migrations ./lib/db/migrations
COPY --from=builder --chown=nextjs:nodejs /app/dist-scripts ./scripts

# Copy and set up entrypoint script
COPY --chown=nextjs:nodejs docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Set entrypoint and command
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
