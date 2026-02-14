# Visa Automation

TypeScript monorepo for visa application automation: control-plane API, data-plane worker (Playwright), and admin/staff UIs. Jobs are queued via Redis (BullMQ), processed by the worker through a portal driver (e.g. as-visa) and FSM, with optional HITL and Telegram/email notifications.

## Project structure

```
apps/
├── cp/              # Control-plane API (port 3001): /cp/* + /api/jobs
├── dp/              # Data-plane worker: queue consumer, portal drivers, FSM
└── web/
    ├── admin-portal/   # Next.js admin (3002)
    ├── staff-portal/   # Next.js staff (3003)
    └── mock-portal/    # Mock AS Visa UI (3004)

packages/
├── db/              # Postgres client, schema, migrations, repos
└── shared/          # Types, FSM, queue payloads, constants

infra/docker/        # dev | test | prod – each has compose.yml + .env.example
scripts/             # db/migrate.sh, db/seed.sh, certs/gen-dev-mtls.sh
docs/                # REFERENCE, ENDPOINTS
```

- **CP:** Single API for control-plane (agents, jobs, customers, staff, HITL, notify, watcher, settings, audit) and public job API (create, status, stop/ack).
- **DP:** Picks jobs from Redis, runs the portal driver (e.g. as-visa), FSM, notify/HITL. Add a new portal by implementing a driver under `apps/dp/portals/<id>/` and registering it.

## Features & capacity

**What it does**
- **Job queue:** Create jobs via API (tenant by `x-tenant-id`), priority queue (Redis/BullMQ), status/list and Telegram stop/ack.
- **Automation:** DP worker runs a portal driver (Playwright), FSM with checkpoints, config from system_settings → profile → portal → job.
- **HITL:** Human-in-the-loop for captcha/OTP; tasks in CP, assign/resolve via API.
- **Notifications:** Telegram (slot open, booked, HITL, failures), optional email/webhook; action buttons use `NOTIFY_ACTION_TOKEN`.
- **Control-plane:** Agents (async/sync), profiles, portal configs, customers, staff, audit log, watcher (snapshots/diffs), system settings (per-tenant + global).
- **Security:** Optional Postgres mTLS (`DB_SSL_*`); tenant isolation on all CP and job API routes.

**Capacity & limits**
- **Scaling:** Add more DP worker instances; each worker runs an agent pool (async agents consume queue, sync agents can be assigned from CP). Limits set via env (`ASYNC_AGENT_COUNT`, `SYNC_AGENT_COUNT`, `MAX_AGENTS`) and system_settings.
- **Throughput:** Bound by browser instances (one job per agent at a time) and portal rate limits; single-server deployment is the typical target.
- **API limits:** e.g. job list/migrations pagination (limit caps ~100–500), batch-status up to 100 ids, audit export up to 10k rows. See [docs/ENDPOINTS.md](docs/ENDPOINTS.md) for query params.

## Quick start

**Prerequisites:** Node.js 20+, Docker & Docker Compose. For running migrations from the host (Option A or B below), `psql` must be on your PATH (PostgreSQL client).

```bash
git clone <repo>
cd visa-automation
npm install
```

**Option A – Docker (all services)**

```bash
npm run docker:up
# From repo root once Postgres is up (DB_* default to localhost:5432):
npm run db:migrate
npm run db:seed
```

Services: Postgres 5432, Redis 6379, **CP 3001**, Admin 3002, Staff 3003, Mock 3004.

**Option B – Local (CP + DP; Postgres/Redis in Docker)**

```bash
# 1) Start DB and Redis
cd infra/docker/dev && cp .env.example .env && docker compose up -d postgres redis
cd ../..

# 2) From repo root: env for local runs (migrate + dev:cp/dev:dp read this)
cp infra/docker/dev/.env.example .env
# Edit .env: NOTIFY_ACTION_TOKEN, DB_HOST=localhost, REDIS_HOST=localhost, TELEGRAM_* as needed

npm run db:migrate
npm run db:seed
npm run dev:cp      # Terminal 1
npm run dev:dp      # Terminal 2
# Optional: npm run dev:admin-portal, dev:staff-portal, dev:mock-portal
```

Create a job:

```bash
curl -s -X POST http://localhost:3001/api/jobs \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: default" \
  -d '{"portal_id":"as-visa","visa_type":"SCHENGEN","applicant":{"name":"Test"}}'
```

Check health: `curl http://localhost:3001/cp/health/ready`

## Scripts (from repo root)

| Script | Description |
|--------|-------------|
| `npm run dev:cp` | Run CP API (3001) |
| `npm run dev:dp` | Run DP worker |
| `npm run dev:admin-portal` | Admin UI (3002) |
| `npm run dev:staff-portal` | Staff UI (3003) |
| `npm run dev:mock-portal` | Mock portal (3004) |
| `npm run docker:up` | Start dev stack (infra/docker/dev) |
| `npm run docker:down` | Stop dev stack |
| `npm run db:migrate` | Run DB migrations |
| `npm run db:seed` | Seed DB |
| `npm run build` | Build all workspaces |
| `npm run typecheck` | TypeScript check |

E2E tests live in `tests/e2e/`. From repo root: `npm run e2e:claim` runs the job lock concurrency test (requires Postgres up, migrations and seed applied).

## Documentation

- **[docs/REFERENCE.md](docs/REFERENCE.md)** – Functionality & capacity, env, config merge, mTLS, notify, run
- **[docs/ENDPOINTS.md](docs/ENDPOINTS.md)** – Full API endpoint list

## Configuration

Env template: **infra/docker/dev/.env.example** (dev) or **infra/docker/prod/.env.example** (prod). For local runs copy to `.env` at repo root; for Docker copy to `infra/docker/dev/.env` (or prod). Key variables:

- **Required for notifications:** `NOTIFY_ACTION_TOKEN` (e.g. `openssl rand -base64 32`), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS_OPS`
- **DB:** `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- **CP/DP:** `CP_API_URL`, `PUBLIC_API_URL` (same host as CP); DP: `USE_MOCK_PORTAL=true` to target mock portal
- **Frontends:** `NEXT_PUBLIC_CP_API_URL`, `NEXT_PUBLIC_API_URL`

Full list and details: **docs/REFERENCE.md** and `infra/docker/dev/.env.example`.

## License

Private – All rights reserved.
