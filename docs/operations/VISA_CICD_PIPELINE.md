## Scope Labels

This document defines the **CI/CD and deployment pipeline**.

- **[MVP REQUIRED]** → must exist for first production deployment
- **[OPS]** → operational/maintenance best practices
- **[PHASED / LATER]** → optional or future improvements

This is a deployment reference spec, not an execution checklist.

---

# CI/CD Pipeline Guide (Docker Compose)

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Architecture Specification](../architecture/VISA_SAAS_ARCHITECTURE.md) | [Docker Production Guide](../operations/VISA_DOCKER_COMPOSE_PRODUCTION.md) | [Zero-Downtime Deployment](../operations/VISA_ZERO_DOWNTIME_DEPLOYMENT.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Environments](#environments)
3. [Pipeline Stages](#pipeline-stages)
4. [Deployment Strategy](#deployment-strategy)
5. [Tools & Technologies](#tools--technologies)
6. [Pipeline Configuration](#pipeline-configuration)
7. [Rollback Procedures](#rollback-procedures)
8. [Why No ArgoCD](#why-no-argocd)

---

## Overview

This guide defines the CI/CD pipeline for the Visa Automation SaaS platform, designed for a **single-server Docker Compose** production environment.

### Pipeline Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Immutable Artifacts** | Docker images are built once, promoted between environments |
| **Tag-Based Promotion** | Images move through environments via tag updates |
| **No In-Place Mutations** | Containers are replaced, never modified |
| **Automated Testing** | All changes pass automated tests before deployment |
| **Manual Production Gates** | Production deployments require explicit approval |

---

## Environments

The pipeline supports four distinct environments, each with complete isolation:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        ENVIRONMENT PROGRESSION                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌───────────┐      ┌───────────┐      ┌───────────┐      ┌───────────┐        │
│  │    DEV    │─────▶│   TEST    │─────▶│   STAGE   │─────▶│   PROD    │        │
│  │           │      │           │      │           │      │           │        │
│  │ Automatic │      │ Automatic │      │  Manual   │      │  Manual   │        │
│  │  Deploy   │      │  Deploy   │      │  Trigger  │      │ Approval  │        │
│  └───────────┘      └───────────┘      └───────────┘      └───────────┘        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Environment Details

| Environment | Purpose | Data | Trigger | Approval |
|-------------|---------|------|---------|----------|
| **dev** | Development, feature testing | Synthetic/mock | Push to feature branch | None |
| **test** | Automated testing, integration | Test fixtures | Merge to `main` | None |
| **stage** | Pre-production validation | Anonymized production-like | Manual trigger | None |
| **prod** | Production | Real customer data | Manual trigger | Required |

### Environment Isolation

Each environment has completely isolated:

| Component | Isolation Method |
|-----------|------------------|
| **Configuration** | Separate `.env` files per environment |
| **Secrets** | Separate Docker secrets per environment |
| **Data** | Separate databases (different hosts or databases) |
| **Network** | No cross-environment communication |
| **DNS** | Different domains (e.g., `dev.visa.internal`, `prod.visa.example.com`) |

---

## Pipeline Stages

### Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            CI/CD PIPELINE STAGES                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STAGE 1: LINT & TEST                                                   │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • ESLint / Prettier checks                                             │    │
│  │  • TypeScript compilation                                               │    │
│  │  • Unit tests (Jest/Vitest)                                             │    │
│  │  • Integration tests                                                    │    │
│  │  • Coverage reporting                                                   │    │
│  │                                                                         │    │
│  │  Failure: Pipeline stops, PR cannot merge                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STAGE 2: BUILD DOCKER IMAGES                                           │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Build API image                                                      │    │
│  │  • Build Worker image                                                   │    │
│  │  • Multi-stage builds for minimal image size                            │    │
│  │  • Tag with commit SHA and branch                                       │    │
│  │                                                                         │    │
│  │  Tags: registry/api:sha-abc1234, registry/api:feature-xyz              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STAGE 3: SECURITY SCAN                                                 │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Generate SBOM (Software Bill of Materials)                           │    │
│  │  • Vulnerability scanning (Trivy, Grype, or similar)                    │    │
│  │  • License compliance check                                             │    │
│  │  • Fail on HIGH/CRITICAL vulnerabilities (configurable)                 │    │
│  │                                                                         │    │
│  │  Output: SBOM artifact, vulnerability report                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STAGE 4: IMAGE SIGNING                                                 │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Sign images with Cosign or Notary                                    │    │
│  │  • Signature stored in registry alongside image                         │    │
│  │  • Enables verification before deployment                               │    │
│  │                                                                         │    │
│  │  Purpose: Ensure image integrity, prevent tampering                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STAGE 5: PUSH TO REGISTRY                                              │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Push to container registry (Docker Hub, Harbor, ECR, etc.)           │    │
│  │  • Apply environment-specific tags for promotion                        │    │
│  │  • Retain images for rollback capability                                │    │
│  │                                                                         │    │
│  │  Tags after push: :sha-abc1234, :dev, :test, :stage, :prod             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STAGE 6: DEPLOY TO TARGET ENVIRONMENT                                  │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • SSH to target server                                                 │    │
│  │  • docker compose pull                                                  │    │
│  │  • docker compose up -d                                                 │    │
│  │  • Old containers replaced with new ones                                │    │
│  │                                                                         │    │
│  │  For production: Blue/Green deployment via Kong                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STAGE 7: HEALTH CHECKS                                                 │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Verify API responds to health endpoint                               │    │
│  │  • Verify workers are processing (metrics check)                        │    │
│  │  • Check database connectivity                                          │    │
│  │  • Verify Redis connectivity                                            │    │
│  │                                                                         │    │
│  │  Timeout: 5 minutes, then trigger rollback                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ├──── If health check fails ────────────────────┐                         │
│       │                                               ▼                         │
│       │                              ┌─────────────────────────────────────┐    │
│       │                              │  STAGE 9: ROLLBACK                  │    │
│       │                              │  • Revert to previous image tag     │    │
│       │                              │  • docker compose pull && up -d     │    │
│       │                              │  • Alert operations team            │    │
│       │                              └─────────────────────────────────────┘    │
│       │                                                                          │
│       ▼ (If production)                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STAGE 8: MANUAL APPROVAL (Prod only)                                   │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Deployment paused until approved                                     │    │
│  │  • Requires approval from designated reviewers                          │    │
│  │  • Approval logged for audit                                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Stage Details

#### Stage 1: Lint & Test

| Check | Tool | Failure Action |
|-------|------|----------------|
| Linting | ESLint | Block PR merge |
| Formatting | Prettier | Block PR merge |
| Type checking | TypeScript (`tsc --noEmit`) | Block PR merge |
| Unit tests | Jest/Vitest | Block PR merge |
| Integration tests | Jest/Playwright | Block PR merge |
| Coverage | Istanbul/c8 | Warn if below threshold |

#### Stage 2: Build Docker Images

| Image | Dockerfile | Build Args |
|-------|------------|------------|
| API | `docker/api/Dockerfile` | `NODE_ENV=production` |
| Worker | `docker/worker/Dockerfile` | `NODE_ENV=production` |

**Tagging Strategy:**
```
registry.example.com/visa-automation/api:sha-abc1234
registry.example.com/visa-automation/api:main
registry.example.com/visa-automation/api:v1.2.3
```

#### Stage 3: Security Scan

| Scan Type | Tool Options | Failure Threshold |
|-----------|--------------|-------------------|
| Vulnerability | Trivy, Grype, Snyk | HIGH or CRITICAL |
| SBOM Generation | Syft, Trivy | N/A (always generate) |
| License | Trivy, FOSSA | Non-compliant licenses |

#### Stage 4: Image Signing

| Tool | Key Storage | Verification |
|------|-------------|--------------|
| Cosign | KMS or file-based | At deployment time |

#### Stage 5: Push to Registry

**Recommended: GitHub Container Registry (GHCR)** — Free, integrated with GitHub Actions.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    CONTAINER REGISTRY SELECTION                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ✅ RECOMMENDED: GitHub Container Registry (ghcr.io)                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Why GHCR?                                                              │    │
│  │  • FREE for public repos (unlimited storage)                            │    │
│  │  • FREE for private repos with GitHub Actions (included in plan)        │    │
│  │  • No separate account/billing setup                                    │    │
│  │  • Native GITHUB_TOKEN authentication (no secrets needed)               │    │
│  │  • Integrated with GitHub Packages UI                                   │    │
│  │  • Supports multi-arch images                                           │    │
│  │                                                                         │    │
│  │  Limits (Free tier):                                                    │    │
│  │  • Storage: 500MB for private (unlimited public)                        │    │
│  │  • Transfer: 1GB/month for private (unlimited public)                   │    │
│  │  • With GitHub Pro/Team: 2GB storage, 10GB transfer                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ALTERNATIVES:                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  AWS ECR (if already on AWS)                                            │    │
│  │  • Free tier: 500MB/month for 12 months                                 │    │
│  │  • After: ~$0.10/GB storage + $0.09/GB transfer                         │    │
│  │  • Pro: Native IAM integration for EC2 pulls                            │    │
│  │  • Con: Extra AWS configuration                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Docker Hub (simplest, but limited)                                     │    │
│  │  • Free tier: 1 private repo, unlimited public                          │    │
│  │  • Rate limits: 100 pulls/6hrs (anonymous), 200/6hrs (free account)     │    │
│  │  • Con: Rate limits can break CI/CD                                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ❌ Harbor (NOT recommended for this use case)                          │    │
│  │  • Requires self-hosting (2+ GB RAM, storage, maintenance)              │    │
│  │  • Overkill for single-server deployment                                │    │
│  │  • Only consider for enterprise with existing k8s cluster               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**GHCR Setup (GitHub Actions):**

```yaml
# .github/workflows/build.yml
name: Build and Push

on:
  push:
    tags: ['v*']

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write  # Required for GHCR push
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}  # Auto-provided, no setup needed
      
      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,prefix=
      
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**Image Naming Convention:**

```
ghcr.io/{org}/{repo}/api:v1.2.3
ghcr.io/{org}/{repo}/worker:v1.2.3
ghcr.io/{org}/{repo}/api:sha-abc1234

Example:
ghcr.io/acme-corp/visa-automation/api:v1.0.0
ghcr.io/acme-corp/visa-automation/worker:v1.0.0
```

**Pulling on Production Server:**

```bash
# One-time setup: Create GitHub PAT with read:packages scope
echo $GITHUB_PAT | docker login ghcr.io -u USERNAME --password-stdin

# docker-compose.yml uses GHCR images
services:
  api:
    image: ghcr.io/acme-corp/visa-automation/api:${VERSION:-latest}
  worker:
    image: ghcr.io/acme-corp/visa-automation/worker:${VERSION:-latest}
```

**Environment-Based Image Tags:**

| Environment | Tag Pattern | Example |
|-------------|-------------|---------|
| Development | `sha-{commit}` | `sha-abc1234` |
| Staging | `v{version}-rc` | `v1.2.0-rc` |
| Production | `v{version}` | `v1.2.0` |

#### Stage 6: Deploy

```bash
# Deploy script executed via SSH
#!/bin/bash
set -euo pipefail

cd /opt/visa-automation
docker compose pull
docker compose up -d --remove-orphans
```

#### Stage 7: Health Checks

| Check | Endpoint/Method | Timeout |
|-------|-----------------|---------|
| API readiness | `GET /health/ready` | 30s |
| API liveness | `GET /health/live` | 10s |
| Worker metrics | `GET /metrics` (check `active_workers > 0`) | 60s |
| Database | Connection test | 10s |

---

## Deployment Strategy

### Tag-Based Promotion

Images flow through environments by updating tags, not rebuilding:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          TAG-BASED PROMOTION FLOW                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Build creates image:  api:sha-abc1234                                          │
│                              │                                                   │
│                              ▼                                                   │
│  Promote to dev:       api:sha-abc1234 → api:dev                                │
│                              │                                                   │
│                              ▼                                                   │
│  Promote to test:      api:sha-abc1234 → api:test                               │
│                              │                                                   │
│                              ▼                                                   │
│  Promote to stage:     api:sha-abc1234 → api:stage                              │
│                              │                                                   │
│                              ▼                                                   │
│  Promote to prod:      api:sha-abc1234 → api:prod                               │
│                                                                                  │
│  Key: Same image (sha-abc1234) flows through all environments.                  │
│       Only the tag changes; the image digest remains identical.                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### No In-Place Mutations

| Principle | Implementation |
|-----------|----------------|
| **Containers are ephemeral** | Never SSH into containers to make changes |
| **State is external** | All state in PostgreSQL, Redis, volumes |
| **Config via environment** | Changes require new deployment |
| **Rollback via tags** | Revert to previous tag, not manual fixes |

### Rollback via Tag Revert

```bash
# Rollback by reverting to previous image tag
#!/bin/bash
set -euo pipefail

PREVIOUS_TAG="${1:?Usage: rollback.sh <previous_tag>}"

cd /opt/visa-automation

# Update docker-compose to use previous tag
sed -i "s/:prod/:${PREVIOUS_TAG}/g" docker-compose.yml

# Deploy previous version
docker compose pull
docker compose up -d --remove-orphans

# Verify health
./scripts/health_check.sh
```

---

## Tools & Technologies

### CI/CD Platform Options

| Platform | Best For | Notes |
|----------|----------|-------|
| **GitHub Actions** | GitHub repositories | Native integration, good free tier |
| **GitLab CI** | GitLab repositories | Built-in registry, good self-hosted option |
| **Jenkins** | Complex pipelines, legacy | Requires maintenance, highly customizable |
| **CircleCI** | Fast builds | Good caching, easy config |

### Supporting Tools

| Category | Tool | Purpose |
|----------|------|---------|
| **Container Registry** | Harbor, ECR, Docker Hub | Store Docker images |
| **Secrets Management** | Docker Secrets, Vault | Store deployment secrets |
| **Vulnerability Scanning** | Trivy, Grype, Snyk | Scan images for CVEs |
| **Image Signing** | Cosign | Verify image integrity |
| **SBOM** | Syft | Generate software inventory |

### SSH-Based Deployment

For single-server deployments, SSH is sufficient and simpler than alternatives:

```yaml
# Example: GitHub Actions deploy step
- name: Deploy to production
  uses: appleboy/ssh-action@master
  with:
    host: ${{ secrets.PROD_HOST }}
    username: deploy
    key: ${{ secrets.DEPLOY_SSH_KEY }}
    script: |
      cd /opt/visa-automation
      docker compose pull
      docker compose up -d --remove-orphans
```

---

## Pipeline Configuration

### GitHub Actions Example

```yaml
# .github/workflows/ci-cd.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_PREFIX: ${{ github.repository }}

jobs:
  # ============================================
  # Stage 1: Lint & Test
  # ============================================
  lint-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Lint
        run: npm run lint
      
      - name: Type check
        run: npm run typecheck
      
      - name: Test
        run: npm test -- --coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  # ============================================
  # Stage 2: Build Docker Images
  # ============================================
  build:
    needs: lint-test
    runs-on: ubuntu-latest
    outputs:
      api-image: ${{ steps.meta-api.outputs.tags }}
      worker-image: ${{ steps.meta-worker.outputs.tags }}
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Log in to registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Extract metadata (API)
        id: meta-api
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_PREFIX }}/api
          tags: |
            type=sha
            type=ref,event=branch
            type=semver,pattern={{version}}
      
      - name: Build and push API
        uses: docker/build-push-action@v5
        with:
          context: .
          file: docker/api/Dockerfile
          push: true
          tags: ${{ steps.meta-api.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      
      # Repeat for worker image...

  # ============================================
  # Stage 3: Security Scan
  # ============================================
  security-scan:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ needs.build.outputs.api-image }}
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'HIGH,CRITICAL'
      
      - name: Upload Trivy scan results
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'
      
      - name: Generate SBOM
        uses: anchore/sbom-action@v0
        with:
          image: ${{ needs.build.outputs.api-image }}
          artifact-name: sbom.spdx.json

  # ============================================
  # Stage 4: Deploy to Staging
  # ============================================
  deploy-stage:
    needs: [build, security-scan]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: Deploy to staging
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.STAGE_HOST }}
          username: deploy
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            cd /opt/visa-automation
            export IMAGE_TAG=${{ github.sha }}
            docker compose pull
            docker compose up -d --remove-orphans
      
      - name: Health check
        run: |
          for i in {1..30}; do
            if curl -sf https://stage.visa.example.com/health/ready; then
              echo "Health check passed"
              exit 0
            fi
            sleep 10
          done
          echo "Health check failed"
          exit 1

  # ============================================
  # Stage 5: Deploy to Production (Manual)
  # ============================================
  deploy-prod:
    needs: deploy-stage
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: 
      name: production
      url: https://visa.example.com
    steps:
      - name: Deploy to production
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.PROD_HOST }}
          username: deploy
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            cd /opt/visa-automation
            export IMAGE_TAG=${{ github.sha }}
            ./scripts/deploy-blue-green.sh
      
      - name: Verify deployment
        run: |
          ./scripts/verify-production.sh
```

---

## Rollback Procedures

### Automatic Rollback

If health checks fail after deployment:

```bash
#!/bin/bash
# scripts/auto-rollback.sh
set -euo pipefail

CURRENT_TAG=$(docker inspect --format='{{.Config.Image}}' visa-api | cut -d: -f2)
PREVIOUS_TAG="${PREVIOUS_TAG:-previous}"

echo "Rolling back from ${CURRENT_TAG} to ${PREVIOUS_TAG}"

# Update compose file
sed -i "s/${CURRENT_TAG}/${PREVIOUS_TAG}/g" docker-compose.yml

# Deploy previous version
docker compose pull
docker compose up -d --remove-orphans

# Verify
sleep 30
if ! curl -sf http://localhost:3000/health/ready; then
  echo "CRITICAL: Rollback also failed!"
  exit 1
fi

echo "Rollback successful"
```

### Manual Rollback

```bash
# 1. Identify the last known good tag
docker image ls | grep visa-api

# 2. Update docker-compose.yml to use that tag
vim docker-compose.yml
# Change: image: registry/api:sha-bad1234
# To:     image: registry/api:sha-good5678

# 3. Deploy
docker compose pull
docker compose up -d

# 4. Verify
curl http://localhost:3000/health/ready
```

---

## Why No ArgoCD

ArgoCD is a GitOps tool designed for Kubernetes environments. It is not used in this architecture for the following reasons:

### Architecture Mismatch

| Factor | Our Architecture | ArgoCD Requirement |
|--------|------------------|-------------------|
| **Runtime** | Docker Compose | Kubernetes |
| **Server count** | Single server | Cluster-oriented |
| **Complexity** | Simple | Adds operational overhead |

### Operational Simplicity

| Aspect | Docker Compose + SSH | ArgoCD |
|--------|----------------------|--------|
| **Setup complexity** | Low | High (requires K8s cluster) |
| **Maintenance** | Minimal | Requires K8s expertise |
| **Debugging** | Straightforward | Requires ArgoCD knowledge |
| **Resource overhead** | None | ArgoCD pods, Redis, etc. |

### What We Use Instead

| ArgoCD Feature | Our Alternative |
|----------------|-----------------|
| GitOps sync | Git triggers CI/CD pipeline |
| Declarative config | `docker-compose.yml` in Git |
| Rollback | Tag-based image rollback |
| Health monitoring | Docker health checks + Grafana |
| Multi-environment | Separate compose files per environment |

### When ArgoCD Would Make Sense

- Multi-server Kubernetes deployment
- Need for complex rollout strategies (canary across nodes)
- Team already has Kubernetes expertise
- Higher availability requirements

For a single-server Docker Compose deployment, SSH-based deployment with proper health checks and rollback procedures is simpler and sufficient.


---

## Architecture Notes

### Agent / Worker Scaling [OPS]
When increasing worker/agent count:
- scale gradually
- avoid sudden bursts
- monitor 403/429 rates

Rapid scale-up may trigger portal bans.

### Canary Health Check [MVP REQUIRED]
After each deployment:
- run canary job per portal
- verify selectors/DOM still valid
- fail pipeline if canary fails

Prevents broken releases from reaching production.

---
