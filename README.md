# TokenPlan v2 — Next.js + MySQL + Docker

A multi-user AI usage dashboard. Rewrite of the original browser-only TokenPlan
(`../token-plan`) into a real app with:

- **Next.js 14 (App Router) + TypeScript**
- **MySQL 8** for persistence (via Prisma ORM)
- **User registration + login** (NextAuth credentials, bcrypt, JWT sessions)
- **Backend admin area** — manage users, view all usage, edit plans/pricing,
  manage provider API keys
- **Server-side provider calls** — API keys live in the DB and never reach the
  browser
- **Docker Compose** — one command to run app + database

## Features

| Area | What it does |
|------|--------------|
| Calculator | Estimate token cost across models (ported token heuristic + cost math) |
| Dashboard | Per-user usage totals + Chart.js charts (read server-side from the DB) |
| Plans | Compare plans, view model pricing, select your plan |
| AI Chat | Chat with a provider; usage is logged to your account |
| API Keys | Create/revoke personal keys and call the AI programmatically |
| Admin › Users | List/search, change role/plan, enable/disable, delete |
| Admin › Usage | Platform-wide usage log + totals |
| Admin › Plans | Edit plan allowances/fees and per-model pricing |
| Admin › Providers | Edit provider base URLs, chat paths, and API keys (write-only) |

## Quick start (Docker)

```bash
cd app
cp .env.example .env          # then edit secrets (see below)
docker compose up --build
```

Open http://localhost:8914. On first boot the `web` container (via
[`docker-entrypoint.sh`](docker-entrypoint.sh)):
1. syncs the schema to MySQL (`prisma db push`),
2. seeds plans, model pricing, providers, and a default admin (idempotent),
3. starts the Next.js standalone server.

The `db` service is a `mysql:8.0` container with a healthcheck; `web` waits for
it to be healthy before starting. Data persists in the `db_data` volume across
restarts.

### Configure `.env`

At minimum set:

- `NEXTAUTH_SECRET` — `openssl rand -base64 32`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — the seeded admin account
- `SEED_*_API_KEY` — provider keys to seed (optional; you can also add them
  later in **Admin › Providers**). Supported providers: DeepSeek, MiniMax,
  LongCat, **OpenAI**, and **Anthropic**.

The default `DATABASE_URL` (`mysql://tokenplan:tokenplan@db:3306/tokenplan`)
matches the MySQL service in `docker-compose.yml`.

### Log in

- **Admin:** the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set → lands on the app,
  with an **Admin** link in the sidebar.
- **Users:** register at `/register` (assigned the `free` plan by default).

### Common commands

```bash
docker compose up --build       # build + start
docker compose logs -f web      # follow app logs
docker compose down             # stop (keeps data)
docker compose down -v          # stop + wipe the database volume
```

## Local development (without Docker)

Requires a running MySQL. Then:

```bash
cd app
npm install
cp .env.example .env          # set DATABASE_URL to your local MySQL (127.0.0.1)
npx prisma db push            # create tables
npm run db:seed               # seed plans/models/providers/admin
npm run dev
```

## Project layout

```
app/
  prisma/schema.prisma   # User, UsageLog, Plan, ModelPricing, ProviderConfig
  prisma/seed.ts         # idempotent seed
  src/lib/               # prisma, auth, session, tokenizer, providers, catalog, usage
  src/app/               # login/register, (app) user pages, admin area, api routes
  src/components/        # Sidebar, ModelChips, Providers (SessionProvider)
  Dockerfile, docker-compose.yml, docker-entrypoint.sh, .env.example
```

## Data model

- `User` — email, bcrypt `passwordHash`, `role` (USER/ADMIN), `disabled`, `planId`
- `UsageLog` — per-request tokens + cost, linked to the user
- `Plan` — id, name, fee, allowance (null = unlimited), features
- `ModelPricing` — model id, provider, input/output price, context window, enabled
- `ProviderConfig` — base URL, chat path, `apiKey` (server-only), enabled
- `ApiKey` — per-user key: SHA-256 `keyHash` (unique), display `prefix`,
  `revoked`, `lastUsedAt`. Plaintext (`tp_live_…`) is shown once at creation.

## API routes

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| `POST` | `/api/register` | public | Create a USER account (zod-validated, bcrypt) |
| `*` | `/api/auth/*` | public | NextAuth (CSRF, credentials callback, session) |
| `POST` | `/api/v1/chat/completions` | **API key** | OpenAI-compatible chat, metered per user |
| `GET/POST/DELETE` | `/api/keys` | user (session) | List / create / revoke your API keys |
| `POST` | `/api/plan` | user (session) | Change the current user's plan |
| `POST` | `/api/chat` | user (session) | Server-side provider call + writes a `UsageLog` |
| `GET/PATCH/DELETE` | `/api/admin/users` | admin | List/search, update role/plan/disabled, delete |
| `PATCH` | `/api/admin/plans` | admin | Edit a `Plan` or `ModelPricing` row |
| `GET/PATCH` | `/api/admin/providers` | admin | List (key masked) / update provider config |

Admin routes return **401** if unauthenticated, **403** if the session is not an
admin. An admin cannot demote, disable, or delete their own account.

## Programmatic API (API keys)

Users create keys under **API Keys** in the sidebar. Each key is shown once, then
only a `tp_live_xxxx…` prefix is stored (the full value is SHA-256 hashed). Call
the OpenAI-compatible endpoint with the key as a bearer token:

```bash
curl http://localhost:8914/api/v1/chat/completions \
  -H "Authorization: Bearer tp_live_YOURKEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "LongCat-2.0",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Response is a standard `chat.completion` object (`choices`, `usage`) plus a
non-standard `cost` field (USD). It also works with the OpenAI SDK by pointing
`base_url` at `http://localhost:8914/api/v1`.

The endpoint is OpenAI-compatible on the way in, but the proxy speaks each
upstream provider's native format on the way out — so Anthropic's Messages API
(`/messages`, top-level `system`, `x-api-key` auth) is translated automatically
for models routed to the `anthropic` provider.

Behavior:
- **401** — missing / invalid / revoked key.
- **404** — unknown `model`.
- **429** — the user's plan monthly token allowance is exceeded (free = 500K;
  pay-as-you-go = unlimited). Enforced from `UsageLog` for the current UTC month.
- Every successful call writes a `UsageLog` row with `source="api"` and stamps
  the key's `lastUsedAt`.

## Security notes

- Provider API keys are stored in `ProviderConfig` and used **only** server-side
  in `POST /api/chat`. They are never sent to the browser; admin responses mask
  the key and the key field is write-only.
- Passwords are bcrypt-hashed; sessions are httpOnly JWT cookies (NextAuth).
- `/admin/*` is gated by both middleware and per-route checks (role = ADMIN).
- Admins cannot demote, disable, or delete their own account (anti-lockout).

> ⚠️ **Rotate leaked keys.** The original app committed real provider keys in
> `token-plan/.env` and `token-plan/js/config.js`. Those keys should be rotated
> with each provider — treat them as compromised.

## Migrations & seeding

- The container uses `prisma db push` for simplicity (no migration files
  needed). To adopt versioned migrations, run `npx prisma migrate dev` locally
  to generate them, commit `prisma/migrations/`, and switch the entrypoint to
  `prisma migrate deploy`.
- In Docker the seed is **precompiled** to `prisma/dist/seed.js` during the
  build and run with plain `node` (the standalone runner image has no `ts-node`
  or `node_modules/.bin` symlinks). Locally, `npm run db:seed` still runs the
  TypeScript source via `ts-node`.

## Verified

Built and run end-to-end with `docker compose up --build` against MySQL 8:
schema sync + seed on boot, register/login (admin + user), route guards
(401/403, self-lockout protection), plan/price/provider edits persisting to the
DB, provider keys stored server-side and returned masked, and the chat route
reaching the provider server-side. See the smoke-test flow in the sections
above.

## Original app

The legacy static version remains in `../token-plan` for reference. It can be
removed once you've verified v2.
