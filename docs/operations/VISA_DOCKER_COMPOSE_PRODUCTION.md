## Scope Labels

This document defines the **production Docker Compose deployment**.

- **[MVP REQUIRED]** → must exist for first production deployment
- **[OPS]** → operational best practices & tuning
- **[PHASED / LATER]** → optional enhancements

This is a production deployment reference. Do not remove hardening/security settings.

---

# Production Docker Compose Guide

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Architecture Specification](../architecture/VISA_SAAS_ARCHITECTURE.md) | [CI/CD Pipeline](../operations/VISA_CICD_PIPELINE.md) | [Zero-Downtime Deployment](../operations/VISA_ZERO_DOWNTIME_DEPLOYMENT.md)

---

## Table of Contents

1. [Purpose](#purpose)
2. [Core Principles](#core-principles)
3. [Services Overview](#services-overview)
4. [Security Hardening](#security-hardening)
5. [Browser Container Requirements (Worker)](#browser-container-requirements-worker)
6. [Resource Limits](#resource-limits)
7. [Secrets Management](#secrets-management)
8. [Network Configuration](#network-configuration)
9. [Volume Configuration](#volume-configuration)
10. [Health Checks](#health-checks)
11. [Deployment Commands](#deployment-commands)
12. [Example Configuration](#example-configuration)

---

## Purpose

This guide defines the production-grade Docker Compose setup for the Visa Automation SaaS platform, including security hardening, resource limits, secrets management, and network isolation.

### Production vs Development

| Aspect | Development | Production |
|--------|-------------|------------|
| **Security** | Relaxed for convenience | Fully hardened |
| **Resources** | Unlimited | Explicitly limited |
| **Secrets** | Environment variables | Docker Secrets |
| **Networking** | Single network | Isolated networks |
| **Logging** | Console | JSON to Loki |
| **Restart policy** | `no` | `unless-stopped` |

---

## Core Principles

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        PRODUCTION DEPLOYMENT PRINCIPLES                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. SINGLE-SERVER DEPLOYMENT                                            │    │
│  │     • All services run on one VM                                        │    │
│  │     • Simplifies operations and debugging                               │    │
│  │     • Vertical scaling only                                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  2. NON-ROOT CONTAINERS                                                 │    │
│  │     • All containers run as non-root user (UID 1000)                    │    │
│  │     • Prevents privilege escalation attacks                             │    │
│  │     • Follows principle of least privilege                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  3. READ-ONLY FILESYSTEMS                                               │    │
│  │     • Container root filesystems are read-only                          │    │
│  │     • Prevents runtime modifications by attackers                       │    │
│  │     • tmpfs for necessary writable paths                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  4. EXPLICIT RESOURCE LIMITS                                            │    │
│  │     • CPU and memory limits prevent runaway containers                  │    │
│  │     • Protects against noisy neighbor problems                          │    │
│  │     • Enables predictable performance                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  5. SECRETS VIA DOCKER SECRETS                                          │    │
│  │     • No plaintext secrets in environment variables                     │    │
│  │     • Secrets mounted as files in containers                            │    │
│  │     • Encrypted at rest                                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  6. NO IMPLICIT NETWORKING                                              │    │
│  │     • Explicit network definitions                                      │    │
│  │     • Services only connect to required networks                        │    │
│  │     • Edge network separated from internal network                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Services Overview

### Service Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            SERVICE ARCHITECTURE                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                              INTERNET                                            │
│                                  │                                               │
│                                  │ Port 443 (HTTPS)                              │
│                                  ▼                                               │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                           EDGE NETWORK                                     │  │
│  │  ┌─────────────────────────────────────────────────────────────────────┐  │  │
│  │  │                           KONG                                      │  │  │
│  │  │  • TLS termination                                                  │  │  │
│  │  │  • Authentication                                                   │  │  │
│  │  │  • Rate limiting                                                    │  │  │
│  │  │  • Load balancing (for blue/green)                                  │  │  │
│  │  └─────────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                  │                                               │
│                                  │ Internal HTTP                                 │
│                                  ▼                                               │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                          INTERNAL NETWORK                                  │  │
│  │                                                                            │  │
│  │  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐            │  │
│  │  │     API      │      │   Worker 1   │      │   Worker 2   │            │  │
│  │  │  (Node.js)   │      │ (Playwright) │      │ (Playwright) │            │  │
│  │  └──────┬───────┘      └──────┬───────┘      └──────┬───────┘            │  │
│  │         │                     │                     │                     │  │
│  │         └─────────────────────┼─────────────────────┘                     │  │
│  │                               │                                            │  │
│  │                               ▼                                            │  │
│  │  ┌────────────────────────────────────────────────────────────────────┐   │  │
│  │  │                         DATA LAYER                                  │   │  │
│  │  │                                                                     │   │  │
│  │  │   ┌──────────────────┐           ┌──────────────────┐              │   │  │
│  │  │   │    PostgreSQL    │           │      Redis       │              │   │  │
│  │  │   │   (Port 5432)    │           │   (Port 6379)    │              │   │  │
│  │  │   └──────────────────┘           └──────────────────┘              │   │  │
│  │  │                                                                     │   │  │
│  │  └────────────────────────────────────────────────────────────────────┘   │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Services Table

| Service | Image | Purpose | Exposed Ports |
|---------|-------|---------|---------------|
| **kong** | `kong:3.x` | Edge gateway, TLS, auth | 443 (external) |
| **api** | `registry/visa-api:tag` | REST API, business logic | None (internal only) |
| **worker** | `registry/visa-worker:tag` | Browser automation | None (internal only) |
| **postgres** | `postgres:16-alpine` | Primary database | None (internal only) |
| **redis** | `redis:7-alpine` | Queue, cache, leases | None (internal only) |

---

## Security Hardening

### Container Security Settings

Each production container must include these security settings:

```yaml
services:
  api:
    # Run as non-root user
    user: "1000:1000"
    
    # Read-only root filesystem
    read_only: true
    
    # Drop all Linux capabilities
    cap_drop:
      - ALL
    
    # Writable directories via tmpfs
    tmpfs:
      - /tmp:size=100M,mode=1777
      - /var/run:size=10M,mode=755
    
    # Security options
    security_opt:
      - no-new-privileges:true
```

### Security Measures Explained

| Measure | Setting | Purpose |
|---------|---------|---------|
| **Non-root user** | `user: "1000:1000"` | Prevents privilege escalation |
| **Read-only FS** | `read_only: true` | Prevents runtime modifications |
| **Capability drop** | `cap_drop: [ALL]` | Removes unnecessary privileges |
| **tmpfs** | `tmpfs: /tmp:...` | Provides necessary writable paths without persistent risk |
| **No new privileges** | `no-new-privileges:true` | Prevents gaining additional privileges via setuid |

### Additional Hardening Options

```yaml
services:
  api:
    # Seccomp profile (default or custom)
    security_opt:
      - seccomp:default
    
    # Limit system calls (AppArmor on supported systems)
    # security_opt:
    #   - apparmor:docker-default
    
    # Disable inter-container communication except via networks
    # (configured at Docker daemon level)
```

---

## Browser Container Requirements (Worker)

The Worker container runs Chromium via Playwright, which has specific requirements:

### Shared Memory (shm_size)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    CHROMIUM SHARED MEMORY REQUIREMENT                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Problem: Docker's default /dev/shm is 64MB                                      │
│  Impact:  Chromium frequently crashes with "out of memory" errors               │
│                                                                                  │
│  Solution options:                                                               │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Option 1: shm_size (Recommended)                                       │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  services:                                                              │    │
│  │    worker:                                                              │    │
│  │      shm_size: '2gb'                                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Option 2: Chrome flag (Alternative)                                    │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  browser = await chromium.launch({                                      │    │
│  │    args: ['--disable-dev-shm-usage']                                    │    │
│  │  });                                                                    │    │
│  │                                                                         │    │
│  │  Note: May reduce performance; shm_size is preferred                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Font Standardization (Fingerprint Consistency)

To ensure consistent browser fingerprinting across workers and deployments:

```dockerfile
# In Worker Dockerfile
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Install standard font packages
RUN apt-get update && apt-get install -y \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Regenerate font cache
RUN fc-cache -f -v
```

**Why this matters:**
- Different font installations produce different canvas fingerprints
- Target sites may flag inconsistent fingerprints as bot behavior
- Standardized fonts ensure all workers appear identical

### Seccomp Profile

The `seccomp/chromium.json` file whitelists specific syscalls required by Chromium:

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "syscalls": [
    {
      "names": ["clone", "clone3"],
      "action": "SCMP_ACT_ALLOW",
      "args": []
    },
    {
      "names": ["mount", "umount2"],
      "action": "SCMP_ACT_ALLOW"
    }
    // ... additional syscalls for Chromium sandbox
  ]
}
```

> **Note:** A complete Chromium seccomp profile is available in Playwright's Docker images. Extract and customize as needed.

---

## Resource Limits

### Baseline Resource Allocation

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        RESOURCE ALLOCATION (16GB VM)                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Service        CPU Limit    Memory Limit    Memory Reserve    Notes            │
│  ─────────────────────────────────────────────────────────────────────────────  │
│  Kong           0.5 CPU      512 MB          256 MB            Gateway overhead │
│  API            1.0 CPU      1 GB            512 MB            Scales w/requests│
│  Worker (×N)    1.0 CPU      2 GB            1.5 GB            Browser memory   │
│  PostgreSQL     1.0 CPU      2 GB            1 GB              Includes buffers │
│  Redis          0.5 CPU      512 MB          256 MB            Queue + cache    │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                  │
│  Example with 4 workers:                                                         │
│  • Workers:     4 × 2 GB = 8 GB                                                  │
│  • Other:       Kong + API + PG + Redis = ~4 GB                                  │
│  • System:      ~2-4 GB for OS                                                   │
│  • Total:       ~14-16 GB                                                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Resource Limit Configuration

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M

  worker:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 1536M

  postgres:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 1G

  redis:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
```

---

## Secrets Management

### Docker Secrets Configuration

```yaml
# Define secrets at the top level
secrets:
  db_password:
    file: ./secrets/db_password.txt
  jwt_secret:
    file: ./secrets/jwt_secret.txt
  kong_admin_token:
    file: ./secrets/kong_admin_token.txt
  redis_password:
    file: ./secrets/redis_password.txt

services:
  api:
    secrets:
      - db_password
      - jwt_secret
      - redis_password
    environment:
      # Reference secrets via _FILE suffix
      - DB_PASSWORD_FILE=/run/secrets/db_password
      - JWT_SECRET_FILE=/run/secrets/jwt_secret
      - REDIS_PASSWORD_FILE=/run/secrets/redis_password
```

### Secret File Structure

```
secrets/
├── db_password.txt      # PostgreSQL password
├── jwt_secret.txt       # JWT signing key
├── kong_admin_token.txt # Kong admin API token
├── redis_password.txt   # Redis AUTH password
└── .gitignore           # Contains: *
```

### Application Secret Loading

```typescript
// utils/secrets.ts
import { readFileSync, existsSync } from 'fs';

export function loadSecret(envVar: string): string {
  // Check for _FILE variant first (Docker Secrets)
  const fileEnvVar = `${envVar}_FILE`;
  const filePath = process.env[fileEnvVar];
  
  if (filePath && existsSync(filePath)) {
    return readFileSync(filePath, 'utf8').trim();
  }
  
  // Fall back to direct environment variable (dev only)
  const value = process.env[envVar];
  if (!value) {
    throw new Error(`Missing secret: ${envVar} or ${fileEnvVar}`);
  }
  
  return value;
}

// Usage
const dbPassword = loadSecret('DB_PASSWORD');
```

---

## Network Configuration

### Network Isolation

```yaml
networks:
  # Edge network: Kong ↔ Internet
  edge:
    driver: bridge
    internal: false  # Allows external access
  
  # Internal network: All services
  internal:
    driver: bridge
    internal: true   # No external access

services:
  kong:
    networks:
      - edge      # Receives external traffic
      - internal  # Forwards to API
  
  api:
    networks:
      - internal  # Only internal access
  
  worker:
    networks:
      - internal
  
  postgres:
    networks:
      - internal
  
  redis:
    networks:
      - internal
```

### Network Security Rules

| Service | edge Network | internal Network | Internet Access |
|---------|--------------|------------------|-----------------|
| Kong | ✅ | ✅ | ✅ (receives requests) |
| API | ❌ | ✅ | ❌ |
| Worker | ❌ | ✅ | ✅ (accesses target sites) |
| PostgreSQL | ❌ | ✅ | ❌ |
| Redis | ❌ | ✅ | ❌ |

**Note:** Workers need internet access to reach target visa application sites. This is configured via Docker's default networking, not the internal network.

---

## Volume Configuration

### Persistent Volumes

```yaml
volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local
  hitl_data:
    driver: local

services:
  postgres:
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    volumes:
      - redis_data:/data
  
  worker:
    volumes:
      - hitl_data:/data/hitl:rw  # HITL context packs
```

### Volume Backup Considerations

| Volume | Backup Frequency | Backup Method |
|--------|------------------|---------------|
| `postgres_data` | Daily | pg_dump or volume snapshot |
| `redis_data` | Optional | Redis RDB/AOF persistence |
| `hitl_data` | Daily | File system backup |

---

## Health Checks

### Health Check Configuration

```yaml
services:
  api:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health/ready"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  worker:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s  # Browser startup takes longer

  postgres:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  kong:
    healthcheck:
      test: ["CMD", "kong", "health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Health Check Endpoints

| Service | Endpoint | Checks |
|---------|----------|--------|
| API | `/health/ready` | Database, Redis, configuration |
| API | `/health/live` | Process is running |
| Worker | `/health` | Redis, browser ready |

---

## Deployment Commands

### Basic Redeploy (Brief Interruption)

> ⚠️ **Important:** Standard Docker Compose commands (`docker compose up -d`) do NOT provide zero-downtime deployments. Containers are stopped and recreated, causing brief service interruptions.
>
> **For true zero-downtime deployments**, see [VISA_ZERO_DOWNTIME_DEPLOYMENT.md](../operations/VISA_ZERO_DOWNTIME_DEPLOYMENT.md) which covers Blue/Green deployment via Kong upstream routing.

```bash
# Pull latest images
docker compose pull

# Basic redeploy (causes brief interruption during container recreation)
docker compose up -d --remove-orphans

# Verify deployment
docker compose ps
docker compose logs --tail=100
```

**When to use basic redeploy:**
- Development and staging environments
- Off-peak maintenance windows with acceptable downtime
- Emergency hotfixes where speed trumps availability

**When to use Zero-Downtime deployment:**
- Production deployments during business hours
- Any deployment where service interruption is unacceptable
- Canary/gradual rollouts for risk mitigation

### Rollback

Rollback is achieved by reverting image tags:

```bash
# 1. Edit docker-compose.yml to use previous tag
# 2. Pull and deploy
docker compose pull
docker compose up -d

# Or use a backup compose file
docker compose -f docker-compose.backup.yml up -d
```

> **Note:** For instant rollback without service interruption, use the Kong traffic switch method documented in [VISA_ZERO_DOWNTIME_DEPLOYMENT.md](../operations/VISA_ZERO_DOWNTIME_DEPLOYMENT.md#9-rollback-procedures).

### Maintenance Commands

```bash
# View logs
docker compose logs -f api
docker compose logs -f worker

# Restart a specific service
docker compose restart api

# Scale workers (if configured for scaling)
docker compose up -d --scale worker=4

# Execute command in container
docker compose exec api npm run migrate

# View resource usage
docker stats
```

---

## Example Configuration

### Complete Production docker-compose.yml

```yaml
version: '3.8'

# ============================================
# Secrets
# ============================================
secrets:
  db_password:
    file: ./secrets/db_password.txt
  jwt_secret:
    file: ./secrets/jwt_secret.txt
  kong_admin_token:
    file: ./secrets/kong_admin_token.txt
  redis_password:
    file: ./secrets/redis_password.txt

# ============================================
# Networks
# ============================================
networks:
  edge:
    driver: bridge
  internal:
    driver: bridge
    internal: true

# ============================================
# Volumes
# ============================================
volumes:
  postgres_data:
  redis_data:
  hitl_data:

# ============================================
# Services
# ============================================
services:
  # ------------------------------------------
  # Kong Gateway
  # ------------------------------------------
  kong:
    image: kong:3.5-alpine
    user: "1000:1000"
    read_only: true
    cap_drop:
      - ALL
    tmpfs:
      - /tmp:size=100M,mode=1777
    networks:
      - edge
      - internal
    ports:
      - "443:8443"
      - "80:8000"
    environment:
      - KONG_DATABASE=off
      - KONG_DECLARATIVE_CONFIG=/etc/kong/kong.yml
      - KONG_PROXY_LISTEN=0.0.0.0:8000, 0.0.0.0:8443 ssl
      - KONG_ADMIN_LISTEN=127.0.0.1:8001
    volumes:
      - ./kong/kong.yml:/etc/kong/kong.yml:ro
      - ./certs:/etc/kong/certs:ro
    healthcheck:
      test: ["CMD", "kong", "health"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          memory: 256M
    restart: unless-stopped

  # ------------------------------------------
  # API Service
  # ------------------------------------------
  api:
    image: ${REGISTRY}/visa-api:${IMAGE_TAG:-latest}
    user: "1000:1000"
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp:size=100M,mode=1777
    networks:
      - internal
    secrets:
      - db_password
      - jwt_secret
      - redis_password
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=visa_automation
      - DB_USER=visa_app
      - DB_PASSWORD_FILE=/run/secrets/db_password
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - REDIS_PASSWORD_FILE=/run/secrets/redis_password
      - JWT_SECRET_FILE=/run/secrets/jwt_secret
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health/ready"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1G
        reservations:
          memory: 512M
    restart: unless-stopped

  # ------------------------------------------
  # Worker Service
  # ------------------------------------------
  worker:
    image: ${REGISTRY}/visa-worker:${IMAGE_TAG:-latest}
    user: "1000:1000"
    read_only: true
    cap_drop:
      - ALL
    cap_add:
      - SYS_ADMIN  # Required for Chromium sandboxing
    security_opt:
      - no-new-privileges:true
      - seccomp:./seccomp/chromium.json
    # CRITICAL: Chromium requires larger shared memory to avoid crashes
    shm_size: '2gb'
    tmpfs:
      - /tmp:size=500M,mode=1777
    networks:
      - internal
    secrets:
      - db_password
      - redis_password
    environment:
      - NODE_ENV=production
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=visa_automation
      - DB_USER=visa_app
      - DB_PASSWORD_FILE=/run/secrets/db_password
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - REDIS_PASSWORD_FILE=/run/secrets/redis_password
      - WORKER_CONCURRENCY=1
    volumes:
      - hitl_data:/data/hitl:rw
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 2G
        reservations:
          memory: 1536M
    restart: unless-stopped

  # ------------------------------------------
  # PostgreSQL
  # ------------------------------------------
  postgres:
    image: postgres:16-alpine
    user: "999:999"
    read_only: true
    cap_drop:
      - ALL
    tmpfs:
      - /tmp:size=100M,mode=1777
      - /run/postgresql:size=10M,mode=755
    networks:
      - internal
    secrets:
      - db_password
    environment:
      - POSTGRES_USER=visa_app
      - POSTGRES_DB=visa_automation
      - POSTGRES_PASSWORD_FILE=/run/secrets/db_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U visa_app -d visa_automation"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 2G
        reservations:
          memory: 1G
    restart: unless-stopped

  # ------------------------------------------
  # Redis
  # ------------------------------------------
  redis:
    image: redis:7-alpine
    user: "999:999"
    read_only: true
    cap_drop:
      - ALL
    tmpfs:
      - /tmp:size=50M,mode=1777
    networks:
      - internal
    secrets:
      - redis_password
    command: >
      sh -c 'redis-server 
      --requirepass "$$(cat /run/secrets/redis_password)"
      --appendonly yes
      --appendfsync everysec
      --maxmemory 400mb
      --maxmemory-policy allkeys-lru'
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          memory: 256M
    restart: unless-stopped

  # ------------------------------------------
  # PgBouncer (RECOMMENDED for 3+ workers)
  # ------------------------------------------
  # Uncomment this service when scaling beyond 2-3 workers
  # to avoid exhausting PostgreSQL max_connections
  #
  # pgbouncer:
  #   image: edoburu/pgbouncer:1.21.0-p0
  #   user: "999:999"
  #   read_only: true
  #   cap_drop:
  #     - ALL
  #   networks:
  #     - internal
  #   secrets:
  #     - db_password
  #   environment:
  #     - DATABASE_URL=postgres://visa_app:$(cat /run/secrets/db_password)@postgres:5432/visa_automation
  #     - POOL_MODE=transaction
  #     - MAX_CLIENT_CONN=200
  #     - DEFAULT_POOL_SIZE=20
  #     - MIN_POOL_SIZE=5
  #     - RESERVE_POOL_SIZE=5
  #   depends_on:
  #     postgres:
  #       condition: service_healthy
  #   healthcheck:
  #     test: ["CMD", "pg_isready", "-h", "localhost", "-p", "6432"]
  #     interval: 10s
  #     timeout: 5s
  #     retries: 5
  #   deploy:
  #     resources:
  #       limits:
  #         cpus: '0.25'
  #         memory: 128M
  #   restart: unless-stopped
  #
  # When enabled, update API and Worker to connect to pgbouncer:6432
  # instead of postgres:5432
```

### PgBouncer: When to Enable

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PGBOUNCER DECISION MATRIX                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Worker Count    │  PgBouncer?  │  Rationale                                    │
│  ────────────────┼──────────────┼────────────────────────────────────────────── │
│  1-2 workers     │  ❌ Optional  │  Direct PG connections OK, minimal overhead   │
│  3-5 workers     │  ⚠️ Recommend │  Approaching default max_connections (100)    │
│  6+ workers      │  ✅ Required  │  Will hit connection limits without pooler    │
│                                                                                  │
│  Connection Math:                                                               │
│  ─────────────────────────────────────────────────────────────────────────────  │
│  Per Worker: ~10-20 connections (ORM pool + query parallelism)                  │
│  API Service: ~20-30 connections                                                │
│  Background Jobs: ~5-10 connections                                             │
│                                                                                  │
│  Example: 5 workers = 5×20 + 30 + 10 = 140 connections → EXCEEDS default!       │
│                                                                                  │
│  With PgBouncer (transaction mode):                                             │
│  - Multiplexes many client connections to few server connections                │
│  - DEFAULT_POOL_SIZE=20 handles all services efficiently                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**To Enable PgBouncer:**

1. Uncomment the `pgbouncer` service above
2. Update `api` and `worker` environment:
   ```yaml
   environment:
     - DB_HOST=pgbouncer  # Changed from postgres
     - DB_PORT=6432       # Changed from 5432
   ```
3. Restart services: `docker compose up -d`

### Directory Structure

```
/opt/visa-automation/
├── docker-compose.yml
├── docker-compose.override.yml  # Local overrides (not in git)
├── .env                         # Environment-specific variables
├── secrets/
│   ├── db_password.txt
│   ├── jwt_secret.txt
│   ├── kong_admin_token.txt
│   ├── redis_password.txt
│   └── .gitignore
├── kong/
│   └── kong.yml                 # Kong declarative config
├── certs/
│   ├── server.crt
│   └── server.key
├── seccomp/
│   └── chromium.json            # Seccomp profile for Playwright
└── scripts/
    ├── deploy.sh
    ├── rollback.sh
    └── health-check.sh
```


---

## Architecture Notes

### Agent / Worker Concurrency [OPS]
Portal load should be controlled via:
- admin portal concurrency policies (SERIAL/PARALLEL)
- then container scaling (`--scale worker=N`)

Do not scale workers aggressively; increase gradually to avoid bans/rate limits.

### Canary Health Check [MVP REQUIRED]
After each deploy:
- run at least one canary job per portal
- verify selectors/DOM
- fail rollout if canary fails

Prevents broken automation reaching production.

---
