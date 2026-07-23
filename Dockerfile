# syntax=docker/dockerfile:1
# Multi-stage build for the Next.js standalone output.

# ---- deps: install all dependencies (incl. dev, for build) ----
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json* ./
# Skip lifecycle scripts here: the `postinstall` runs `prisma generate`, but the
# schema isn't copied yet at this stage. The builder stage generates it instead.
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; else npm install --ignore-scripts; fi

# ---- builder: generate prisma client + build next ----
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL is only needed at runtime; a dummy is fine for `next build`.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build
# Precompile the seed to plain JS so the runner can run it with `node`
# (no ts-node / .bin symlinks needed at runtime).
RUN npx tsc prisma/seed.ts \
  --module CommonJS --target ES2020 --esModuleInterop --skipLibCheck \
  --outDir prisma/dist

# ---- runner: minimal image running the standalone server ----
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone server + static assets.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma runtime needs the schema, generated client, and CLI so the entrypoint
# can run `db push` + seed. The seed is precompiled to prisma/dist/seed.js.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
