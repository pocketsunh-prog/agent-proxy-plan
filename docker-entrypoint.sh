#!/bin/sh
# -----------------------------------------------------------------------------
# Container entrypoint: apply schema to the DB, seed, then start the server.
#
# Uses `prisma db push` (creates/updates tables to match schema.prisma) rather
# than migrate, so no pre-generated migration files are required. It is
# idempotent and safe to run on every boot. Switch to `prisma migrate deploy`
# once you start committing migrations (prisma migrate dev locally).
# -----------------------------------------------------------------------------
set -e

# Call the Prisma CLI directly — the standalone runner image doesn't include the
# node_modules/.bin symlinks that `npx prisma` relies on.
PRISMA="node ./node_modules/prisma/build/index.js"

echo "→ Syncing database schema (prisma db push)…"
$PRISMA db push --skip-generate

echo "→ Seeding database (idempotent)…"
node ./prisma/dist/seed.js || echo "  (seed skipped or already applied)"

echo "→ Starting Next.js…"
exec "$@"
