# Visa Automation SaaS Platform

A TypeScript monorepo for automating visa application processing using headless browser automation (Playwright) with a robust FSM-based job processing system.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VISA AUTOMATION PLATFORM                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐      ┌──────────┐   │
│  │   Kong   │ ───▶ │   API    │ ───▶ │  Redis   │ ◀─── │  Worker  │   │
│  │ Gateway  │      │ (Fastify)│      │ (BullMQ) │      │(Playwright│   │
│  └──────────┘      └──────────┘      └──────────┘      └──────────┘   │
│       │                 │                                    │         │
│       │                 │                                    │         │
│       │                 ▼                                    ▼         │
│       │           ┌──────────┐                        ┌──────────┐   │
│       │           │PostgreSQL│◀───────────────────────│   FSM    │   │
│       └─────────▶ │    16    │                        │  Runner  │   │
│                   └──────────┘                        └──────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
visa-automation/
├── apps/
│   ├── api/          # Fastify REST API
│   └── worker/       # Playwright-based job processor
├── packages/
│   ├── shared/       # Shared types, FSM, constants
│   └── db/           # Database schema, migrations, repositories
├── infra/
│   ├── docker/       # Docker Compose configuration
│   └── kong/         # Kong API Gateway config
├── scripts/
│   └── db/           # Database utility scripts
└── docs/             # Architecture documentation
```

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- PostgreSQL client (for running migrations manually)

### 1. Clone and Install

```bash
cd visa-automation
npm install
```

### 2. Start Infrastructure

```bash
# Start all services (Postgres, Redis, Kong, API, Worker)
cd infra/docker
cp .env.example .env
docker compose up -d
```

### 3. Run Migrations

```bash
# Wait for Postgres to be ready, then run migrations
chmod +x scripts/db/migrate.sh scripts/db/seed.sh
./scripts/db/migrate.sh
./scripts/db/seed.sh
```

### 4. Verify Services

```bash
# Check all services are healthy
docker compose ps

# Check API health
curl http://localhost:3000/health/ready

# Check Kong proxy
curl http://localhost:8000/health/ready
```

## 📋 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health/live` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe (checks DB + Redis) |
| `POST` | `/api/jobs` | Create a new visa automation job |
| `GET` | `/api/jobs/:id` | Get job status by ID |
| `GET` | `/api/jobs?tenant_id=xxx` | List jobs for a tenant |

### Create a Job

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "visa_type": "SCHENGEN",
    "applicant": {
      "name": "Jane Smith",
      "passport_number": "CD9876543",
      "nationality": "UK",
      "email": "jane.smith@example.com"
    },
    "config": {
      "simulate_hitl": false
    }
  }'
```

**Response:**
```json
{
  "job_id": "uuid-here",
  "status": "QUEUED",
  "message": "Job created and queued for processing"
}
```

## 🔄 FSM State Machine

The worker processes jobs through the following states:

```
QUEUED → LOGIN_PROCESS → LOGGED_IN → FORM_FILLING → PROCESSING → COMPLETED
                ↓              ↓            ↓
            WAITING_HITL  WAITING_HITL  WAITING_HITL
                ↓              ↓            ↓
           (Resume after HITL resolution)
```

### HITL (Human-in-the-Loop)

When the worker encounters scenarios requiring human intervention (captchas, OTPs, etc.), it:

1. Creates a `hitl_task` record
2. Transitions job to `WAITING_HITL` state
3. Waits for external resolution via API/webhook
4. Resumes processing after resolution

**Simulated HITL:** Set `config.simulate_hitl: true` to force HITL trigger, or the system randomly triggers HITL ~20% of the time for demo purposes.

## ✅ Stop/Go Success Criteria

Use the following checklist to verify the system is working correctly:

### 1. Infrastructure Health
```bash
# All containers should be "healthy"
docker compose ps
# Expected: postgres, redis, kong, api, worker all show (healthy)
```

### 2. API Readiness
```bash
curl http://localhost:3000/health/ready
# Expected: {"status":"ok","checks":{"database":true,"redis":true}...}
```

### 3. Create and Process Job
```bash
# Create a job
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "visa_type": "SCHENGEN",
    "applicant": {"name": "Test User"}
  }'

# Save the job_id from response, then check status after a few seconds
curl http://localhost:3000/api/jobs/{job_id}
# Expected: {"status":"COMPLETED"...} or {"status":"WAITING_HITL"...}
```

### 4. View Worker Logs
```bash
docker compose logs -f worker
# Expected: State transition logs:
# - Processing job
# - QUEUED -> LOGIN_PROCESS
# - LOGIN_PROCESS -> LOGGED_IN
# - LOGGED_IN -> FORM_FILLING
# - FORM_FILLING -> PROCESSING
# - PROCESSING -> COMPLETED (or WAITING_HITL)
```

### 5. Verify Database State
```bash
docker compose exec postgres psql -U postgres -d visa_automation \
  -c "SELECT id, status, retry_count FROM jobs ORDER BY created_at DESC LIMIT 5;"
# Expected: Jobs with various statuses (COMPLETED, WAITING_HITL, etc.)

docker compose exec postgres psql -U postgres -d visa_automation \
  -c "SELECT job_id, event_type, payload FROM job_events ORDER BY created_at DESC LIMIT 10;"
# Expected: STATE_TRANSITION events showing the FSM progression
```

### 6. HITL Task Verification
```bash
docker compose exec postgres psql -U postgres -d visa_automation \
  -c "SELECT id, job_id, type, status FROM hitl_tasks;"
# Expected: HITL tasks created for jobs that triggered HITL (if any)
```

## 🛠️ Development

### Local Development (without Docker)

```bash
# Terminal 1: Start dependencies
docker compose up postgres redis -d

# Terminal 2: Run API
npm run dev:api

# Terminal 3: Run Worker
npm run dev:worker
```

### Build

```bash
npm run build
```

### Type Check

```bash
npm run typecheck
```

## 📚 Documentation

- [Architecture Specification](docs/architecture/VISA_SAAS_ARCHITECTURE.md)
- [FSM Design](docs/architecture/VISA_FSM_DESIGN.md)
- [Database Schema](docs/architecture/VISA_DATABASE_SCHEMA.md)
- [API Contract](docs/api/VISA_CORE_API_CONTRACT.md)
- [Docker Production Guide](docs/operations/VISA_DOCKER_COMPOSE_PRODUCTION.md)

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API server port |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `visa_automation` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `postgres` | Database password |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `WORKER_CONCURRENCY` | `2` | Number of concurrent jobs per worker |

## 📄 License

Private - All rights reserved.
