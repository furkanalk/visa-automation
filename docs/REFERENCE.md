# Quick reference

Env, config, mTLS, notify, run commands, and a short functionality/capacity summary.

---

## Functionality & capacity

| Area | What’s there |
|------|----------------|
| **Jobs** | Create, list, get, stop, retry, requeue; events/runs; batch-status (up to 100 ids); tenant by UUID or slug (e.g. `default`). |
| **Automation** | One portal driver (as-visa); FSM with checkpoints; config merge: defaults → system_settings → profile → portal → job. |
| **HITL** | Tasks per job; assign to staff; resolve/cancel; pending count. |
| **Notify** | Telegram (slot open, booked, HITL, failures), email, webhook; test endpoints; action links (stop/ack) with token. |
| **CP resources** | Agents (async/sync), profiles, portals, customers, staff, settings (tenant + global), audit, watcher (snapshots/diffs). |
| **Scaling** | Multiple DP workers; per-worker agent counts and max_agents come **only** from **Postgres system_settings** (default_async_agent_count, default_sync_agent_count, max_agents_per_worker), configurable via Admin. No env override. Throughput limited by browser instances and portal. |
| **Limits** | List/export pagination (e.g. limit caps 100–500), batch-status 100 ids, audit export 10k rows. |
| **Security** | Tenant isolation (UUID or slug); optional Postgres mTLS; notify action token in CP **system_settings** (notify.notify_action_token). |

---

## Env (summary)

**Sadece infra/runtime env kaldı.** Tüm iş konfigü (portal, system, notify) **CP (Postgres)** üzerinden: system_settings, portal_configs, notify_settings. Bkz. `docs/CONFIG-AUDIT.md`.

- **DB:** `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL_*` (opsiyonel mTLS).
- **Redis:** `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`.
- **CP/DP kimlik:** `CP_API_URL`, `PUBLIC_API_URL`; DP’de `WORKER_ID`, `TENANT_ID`.
- **Notify (sadece DP→CP auth):** `CP_INTERNAL_SECRET` – CP ve DP’de aynı; DP, `/cp/notify/worker` ile tenant notify ayarlarını alır. Telegram/SMTP ve action token **CP’de** (Admin → Notify + Settings notify).
- **Frontend:** `NEXT_PUBLIC_CP_API_URL`, `NEXT_PUBLIC_API_URL`.
- **Diğer:** `LOG_LEVEL`, `NODE_ENV`, `CORS_ORIGIN`, `DP_HEALTH_PORT`, `USE_MOCK_PORTAL`, `MOCK_PORTAL_URL` (test).

Full list: `infra/docker/{dev|test|prod}/.env.example`.

---

## Config merge order (single source of truth: Postgres)

Config is stored in Postgres: **system_settings**, **portal_configs**, **agent_profiles**. **Dosya tabanlı config yok**; portal ve system değerleri CP’den zorunlu.

Merge order:

1. Defaults (code, sadece tip/şekil; eksikse DP başlamaz)  
2. system_settings (DB, GET /cp/settings)  
3. Profile (agent)  
4. Portal config (**sadece CP** – portal_configs; base_url + config zorunlu)  
5. job.config (highest priority)

CP API validates portal config and profile config (JSON shape) on create/update; invalid payloads return 400.

**Portal config:** **Sadece CP** – Admin → Portals: **base_url** ve **config** (JSON) zorunlu. Portal yoksa veya base_url/config eksikse job fail. `config`: `timeouts` (navigationMs, actionMs), `pacing` (minDelayMs, maxDelayMs, jitter), `rateLimit`, `proxy`, `hitl`, `selectorsVersion`. Migration 015 ile default tenant + as-visa portal eklenebilir; yoksa Admin’den oluşturulmalı.

**System settings:** Migration 010 (system_settings seed); DP başlarken GET /cp/settings ile system kategorisi zorunlu, yoksa DP başlamaz.

**Notify:** Admin → Notify (telegram_bot_token, telegram_chat_ids, smtp_*, fallback_email) + Admin → Settings, notify kategorisi (notify_action_token, notify_action_base_url). Migration 016. DP, GET /cp/notify/worker ile tenant ayarlarını alır (X-Internal-Secret gerekir).

---

## Postgres mTLS

- `DB_SSL_CA_PATH`, optional `DB_SSL_CERT_PATH`, `DB_SSL_KEY_PATH`; `DB_SSL=require` or `verify-full`.
- Dev certs: `./scripts/certs/gen-dev-mtls.sh` → `scripts/certs/dev-mtls/`.
- Migrate: same env vars used by both Node and `migrate.sh` (psql libpq).

---

## Notify (Telegram / email)

- **SLOT OPEN** 🚨, **BOOKED** ✅, **HITL REQUIRED** 🧩, **SLOT CLOSED** 🔴; buttons ACK/STOP (action URL + token; değerler CP system_settings notify.* ve Admin Notify’dan).
- Tüm kanal ayarları **CP’de**: Admin → Notify (Telegram, SMTP, webhook), Settings → notify (notify_action_token, notify_action_base_url). DP env’den okumaz.
- Severity: SLOT_OPEN 🟢, RETRY 🟡, FAILED/SLOT_CLOSED 🔴, BOOKED 🔵.

---

## Running

- **Local:** fill `.env`, run `npm run dev:cp`, `npm run dev:dp`, admin-portal/staff-portal/mock-portal in separate terms. Önce `scripts/db/migrate.sh` ile migration’ları çalıştırın (Postgres ayaktayken).
- **Docker:** `infra/docker/dev/` (veya test/prod); `compose.yml` + `.env`. Sıra: Postgres → **bootstrap** (migrations, tek seferlik) → CP → DP. `docker compose up -d` ile bootstrap otomatik çalışır; tüm default’lar Postgres’e yazılır (idempotent). Backup için `pg_dump` yeterli.
