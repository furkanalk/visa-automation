VISA AUTOMATION — ULTIMATE GUIDE (FINAL)

Single Server • No K8s • Agents = Worker Instances • CP/DP Split

0) Net Tanımlar (Taşlar yerine otursun)
Agent nedir?

Agent = aynı anda ayrı browser session ile çalışan bir “worker instance”.

1 agent = 1 Playwright session/flow (1 job aynı anda)

100 agent = 100 paralel session (aynı anda 100 job koşturma kapasitesi)

Bu, “WORKER_CONCURRENCY=100” gibi tek process concurrency ile de yapılabilir, ama UI’dan tek tek agent’ı disable/drain/assign/role gibi yönetmek istiyorsan mantıksal “agent” kavramını sistemde tutman gerekir.

Worker Instance nedir?

İki yaklaşım var (single server’da ikisi de olur):

A) Tek Worker Process + İçinde N Agent (önerilen MVP/early-prod)

Node process (worker) tek.

İçinde AgentPool var: agents = [{id, status, profileId, mode, assignedPortals}]

Agent sayısı arttıkça aynı process içinde paralel job yürütür.

Yönetimi kolay, deploy basit.

B) Her Agent için ayrı Container/Process (daha ağır, opsiyonel)

Docker compose ile worker-agent-1..N scale

Yönetim karmaşık ama izolasyon yüksek.

Şimdilik gereksiz (tek sunucu + MVP hedefi).

Bu projede default: A)

Senkron / Asenkron Agent

Async agent: Job queue’dan çekip sürekli çalışır (normal worker gibi).

Sync agent: “manual/controlled mode” — CP API üzerinden “bu agent şu job’ı şimdi çalıştır” şeklinde tetiklenir, adım adım ilerletilebilir (özellikle HITL & debug için).

Admin UI’dan:

Async agent count

Sync agent count

Her agentın modu değiştirilebilir (async ↔ sync).

1) Şu anki kod durumu (doğrulama)
Telegram + Email MVP’de var mı?

Evet, mevcut eklediklerin MVP için doğru yönde. Şunlar kritik:

Telegram: SLOT_OPEN + ACK + STOP linkleri token ile korunuyor ✅

Email: slot-open ve booking-confirmed template + sendEmail ✅

Dedupe: Redis SET NX EX ile spam engelleniyor ✅

Slot status: Redis’te open/closed tutuluyor ✅

STOP: API tarafında token doğrulayıp CANCELLED’a çekiyor ✅

Worker: slotHunt içinde shouldAbort() ile CANCELLED görülünce duruyor ✅

FSM runner: her loop’ta CANCELLED check var ✅

Not: “booking için tarih açıldı mı?” check olayı MVP’de “slotHunt -> window.dateDisabled snapshot -> dates.length > 0 ise FOUND” şeklinde var. Bu, “availability” yakalama için yeterli. Booking flow daha sonra.

2) Cursor’ın MUTLAKA yapması gereken ilk şey

docs/ klasöründeki tüm markdown’ları oku.

Mevcut DB şemasını kontrol et (zaten var dedin).

Aşağıda önerilen CP tablolarını eklemeden önce:

mevcut tablolarla çakışma var mı?

job, job_runs, job_events, tenants vs hali hazırda var mı?

naming convention (snake_case, vs) tutarlı mı?

Kural: “Yeni tablo eklemeden önce mevcut şemayı doğrula.”
Cursor bunu “migrations diff” gibi ele alacak.

3) Hedef MVP Definition of Done (DoD)

MVP “bitti” demek için:

docker compose dev ortamında ayağa kalkar

API: /api/jobs ile job oluşturulur

Worker job’ı alır

Fake visa portal slot aç/kapat simüle eder

Slot açıldığında:

Telegram SLOT OPEN mesajı gelir

Email SLOT OPEN gelir

STOP’a basınca:

job CANCELLED olur

worker 1-2 polling içinde durur (abort)

Dedupe spam yapmaz

Health endpoints (API/Worker) çalışır

Loglar jobId/tenantId ile correlate edilir

Bunlar tamamlanmadan MVP bitti sayılmaz.

4) Single Server Environment Plan (Dev / Test / Prod)
DEV (local)

postgres

redis

api

worker

fake-portal

TEST (local ya da test VM)

aynı stack

E2E test + manual approval

PROD (cloud tek sunucu)

postgres (managed önerilir ama şart değil)

redis

api

worker

cp-api

admin-web

staff-web

5) Agent Management Model (CP’nin kalbi)
Agents tablosu (mantıksal)

Agent’lar CP’de kayıtlıdır. Worker process restart olsa bile agent listesi CP’den gelir.

agents

id (uuid)

tenant_id

name

mode: ASYNC | SYNC

status: ONLINE | OFFLINE | DISABLED | DRAINING

profile_id

desired_portals: jsonb (assignments)

desired_concurrency: int (opsiyonel; sync agent = 1)

last_heartbeat_at

Heartbeat

Worker agent pool belirli aralıklarla CP’ye heartbeat atar:

POST /cp/agents/heartbeat
payload: { agentId, status, currentJobId?, browserHealthy, ts }

UI’da online/offline doğru görünür.

6) Profile / Config Yönetimi (UI’dan değişken ayarlama)

Senin “koddaki değişkenlerin portal üzerinden ayarlanması” isteğinin en doğru çözümü:

Tek kaynak: Postgres “config store”

portal pacing/rateLimit/poll interval gibi şeyler DB’de durur.

Worker job başlarken config’i çeker (cache + TTL).

Admin UI config’i günceller, worker otomatik uygular.

Önerilen tablolar

agent_profiles

id

tenant_id

name

config_jsonb
Örnek:

{
  "rateLimit": { "rpm": 30 },
  "pacing": { "minMs": 800, "maxMs": 2000 },
  "slotHunt": { "maxPolls": 12, "sleepMinMs": 1500, "sleepMaxMs": 3000 },
  "navigationTimeoutMs": 30000
}


portal_configs

id

tenant_id

portal_id

config_jsonb (portal bazlı override)

tenant_defaults

tenant_id

config_jsonb (global default)

Merge sırası: tenant_defaults → portal_configs → agent_profile → job override
Worker config resolver bunu uygular.

7) “100 agente profil vermek zor” — Bulk Apply Tasarımı

Admin UI’da şu aksiyonlar olmalı:

Bulk Apply seçenekleri

All agents (hepsine uygula)

Selected agents (checkbox / multi-select)

By filter (portal=AS_VISA, mode=ASYNC, status=ONLINE gibi)

By percentage (%25’ine uygula → random stable selection)

By count (ilk N / random N)

Stable random önerisi:

“random” seçim her seferinde değişmesin diye

seed = tenant_id + profile_id + action_timestamp

agentId hash’e göre sırala, ilk N’i seç.

API örnek:

POST /cp/agents/bulk-assign-profile
body:

{
  "profileId": "uuid",
  "selector": {
    "mode": "ASYNC",
    "portalId": "as-visa",
    "status": ["ONLINE","OFFLINE"],
    "strategy": "PERCENT",
    "value": 30
  }
}

8) Portals & Agent-to-Portal Assignment (Drag&Drop mantığı)

UI önerisi: Portal swimlanes

Portal başına column (kanban gibi)

Agent card’larını sürükleyip portal kolonuna bırakınca assignment yapılır.

Agent card’ında:

profile badge

mode badge (SYNC/ASYNC)

status badge (ONLINE/OFFLINE)

quick actions: disable / drain / toggle mode

API:

POST /cp/agents/:id/assign-portals
{ portals: ["as-visa", "it-visa"] }

9) Notifications (Telegram + Email) — CP’den yönetim

notify_settings

tenant_id

telegram_enabled

email_enabled

telegram_chat_ids

smtp_host/port/user/pass/from

fallback_to

notify_email_override (ops inbox)

API:

GET /cp/notify

PATCH /cp/notify

POST /cp/notify/test/telegram

POST /cp/notify/test/email

10) Site Drift Detection (HTML dump + diff cron) — yeni özellik
Amaç

Her gün (sabah/akşam arası) random bir saatte siteye girip:

HTML snapshot (ve mümkünse DOM map)

bir önceki snapshot ile diff

selector kırılma riski varsa notify

Tasarım

Yeni servis ya da worker içinde cron runner:

Öneri: worker içinde ayrı “watcher” modülü

node dist/watcher.js gibi ayrı entrypoint olabilir

ya da same process içinde cron schedule

Storage

Postgres tablosu veya object storage (şimdilik Postgres yeter)

portal_snapshots

id

portal_id

captured_at

html (text) veya html_hash + stored blob

dom_digest (optional)

diff_summary (text)

Random schedule

CP’de watcher_config:

enabled

window_start_hour

window_end_hour

jitter_min/max

portals enabled list

Watcher her gün window içinde random seçip koşar.

Notify integration

Diff high-risk ise:

Telegram “PORTAL CHANGED”

Email detail + diff summary

11) Drift Detection için API Endpoints

CP API:

GET /cp/watcher

PATCH /cp/watcher (enable/disable, time window, portals)

POST /cp/watcher/run-now (manual trigger)

GET /cp/watcher/snapshots?portalId=...

GET /cp/watcher/snapshots/:id

GET /cp/watcher/diffs/latest?portalId=...

Worker/Watcher internal:

POST /internal/watcher/capture (opsiyonel)

12) Admin Portal / Staff Portal — Yeni Kategoriler (Faydalı ek özellikler)
Admin Portal ek menüler (web UI)

Agents

Portals

Profiles

Jobs

live jobs list

cancel / retry / requeue

HITL

pending tasks list

assign to staff

Notifications

Watcher (Site Drift)

Audit Logs

System Health

Settings

Staff Portal (personel)

My HITL Tasks

OTP / CAPTCHA input

Task History

Quick Actions (request re-run, escalate)

Notifications feed (what changed / what needs attention)

13) “UI kodu gizlenecek” konusu (gerçekçi yaklaşım)

Web tabanlı UI’da frontend kodunu “incelenemez” yapmak mümkün değil.
Minify/obfuscate yapılabilir ama güvenlik sağlamaz.

Doğru güvenlik:

RBAC backend’de

모든 aksiyonlar REST API üzerinden authorize

Audit log tutulur

Sensitive bilgi frontend’e gereksiz gönderilmez

Yapılacaklar:

production build minified

source map kapalı

CSP headers

strict auth cookies/JWT
Ama “tam gizlilik” yok.

14) “Booking check / slot check sıklığı” ve UI’dan ayar

Slot check zaten var: slotHunt poll loop.
Ama sıklık/pacing DB config’ten yönetilmeli.

Bu yüzden:

slotHunt.MAX_POLLS

sleepMin/sleepMax

rateLimit

timeouts.navigationMs

retry delay

hepsi profile/portal config’ten gelmeli.

15) K8s yok: Scaling nasıl olacak?

Single server → scaling seçenekleri:

1) Agent sayısını arttır

Admin UI’dan “Desired agent count” ayarla:

CP: PATCH /cp/agents/scale → { asyncCount: 20, syncCount: 5 }

Worker: CP’den desired state’i alır, AgentPool’u resize eder.

2) Kaynak sınırları

max agent count = CPU/RAM’e göre

“hard cap” CP’de konur (örn max 100)

16) CI/CD (Single Server)
Pipeline

build

typecheck

test

docker build

push registry

SSH deploy (compose pull/up)

Manual approval

TEST stage sonrası approval

PROD stage öncesi approval

17) Cursor için “Yapılacaklar” sırası (net)

Önce doğrula:

docs/ oku

mevcut DB schema inspect

Sonra uygula:
3) Fake visa portal (slot toggle + dateDisabled)
4) docker-compose.dev/test/prod
5) Health endpoints
6) CP DB migrations (agents, profiles, portals, notify, watcher, audit)
7) CP API skeleton (Fastify)
8) Admin Web UI skeleton (Next.js + Tailwind + shadcn)
9) Staff Web UI skeleton
10) Watcher (drift detection) + notify
11) E2E tests + manual gate
12) Prod deploy docs

APPENDIX A — CONTROL PLANE (CP) DATABASE MIGRATIONS

Cursor önce mevcut schema’yı kontrol edecek. Çakışma yoksa aşağıdakileri ekleyecek.

1️⃣ agents
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('ASYNC','SYNC')),
  status TEXT NOT NULL CHECK (status IN ('ONLINE','OFFLINE','DISABLED','DRAINING')),
  profile_id UUID,
  desired_portals JSONB NOT NULL DEFAULT '[]',
  desired_concurrency INT NOT NULL DEFAULT 1,
  last_heartbeat_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_agents_tenant ON agents(tenant_id);
CREATE INDEX idx_agents_status ON agents(status);

2️⃣ agent_profiles
CREATE TABLE agent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_tenant ON agent_profiles(tenant_id);

3️⃣ portal_configs
CREATE TABLE portal_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  portal_id TEXT NOT NULL,
  config JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_portal_config ON portal_configs(tenant_id, portal_id);

4️⃣ notify_settings
CREATE TABLE notify_settings (
  tenant_id UUID PRIMARY KEY,
  telegram_enabled BOOLEAN NOT NULL DEFAULT true,
  telegram_chat_ids TEXT,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  smtp_host TEXT,
  smtp_port INT,
  smtp_user TEXT,
  smtp_pass TEXT,
  smtp_from TEXT,
  fallback_email TEXT,
  email_override TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

5️⃣ watcher_config (site drift detection)
CREATE TABLE watcher_config (
  tenant_id UUID PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  window_start_hour INT NOT NULL DEFAULT 8,
  window_end_hour INT NOT NULL DEFAULT 22,
  portals JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

6️⃣ portal_snapshots
CREATE TABLE portal_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id TEXT NOT NULL,
  captured_at TIMESTAMP NOT NULL DEFAULT now(),
  html_hash TEXT NOT NULL,
  html TEXT NOT NULL,
  diff_summary TEXT
);

CREATE INDEX idx_snapshots_portal ON portal_snapshots(portal_id);

7️⃣ audit_logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  actor_type TEXT,
  actor_id TEXT,
  action TEXT,
  target_type TEXT,
  target_id TEXT,
  payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id);

APPENDIX B — CONTROL PLANE API SPEC

Base: /cp

AGENTS
List

GET /cp/agents

Create

POST /cp/agents

{
  "name": "Agent 1",
  "mode": "ASYNC",
  "profileId": "uuid"
}

Update

PATCH /cp/agents/:id

Bulk Assign Profile

POST /cp/agents/bulk-assign-profile

{
  "profileId": "uuid",
  "selector": {
    "mode": "ASYNC",
    "strategy": "PERCENT",
    "value": 30
  }
}

Scale

PATCH /cp/agents/scale

{
  "asyncCount": 20,
  "syncCount": 5
}

PROFILES

GET /cp/profiles

POST /cp/profiles

PATCH /cp/profiles/:id

DELETE /cp/profiles/:id

PORTALS

GET /cp/portals

PATCH /cp/portals/:portalId

POST /cp/portals/:portalId/assign-agents

NOTIFY

GET /cp/notify

PATCH /cp/notify

POST /cp/notify/test/telegram

POST /cp/notify/test/email

WATCHER

GET /cp/watcher

PATCH /cp/watcher

POST /cp/watcher/run-now

GET /cp/watcher/snapshots

GET /cp/watcher/snapshots/:id

HEALTH

GET /cp/health

GET /cp/system

APPENDIX C — AGENT POOL RUNTIME DESIGN (Worker Side)

Worker process başlarken:

CP’den:

agent list

profiles

portal configs

AgentPool oluşturur.

AgentPool Yapısı
interface AgentRuntime {
  id: string
  mode: 'ASYNC' | 'SYNC'
  status: 'IDLE' | 'RUNNING' | 'DISABLED'
  profile: ProfileConfig
  assignedPortals: string[]
}

Async Agent Loop
while (status === IDLE):
    job = dequeue()
    if job.portal in assignedPortals:
        runFSM(job)

Sync Agent

Sync agent:

Queue dinlemez.

CP’den:
POST /cp/agents/:id/run-job
ile tetiklenir.

Step-by-step ilerleyebilir.

Heartbeat

Her 10 saniye:

POST /cp/agents/heartbeat


Payload:

{
  agentId,
  status,
  currentJobId,
  ts
}

APPENDIX D — SITE DRIFT DETECTION (Watcher Logic)
Günlük Random Execution

Pseudo:

if enabled:
  hour = random(window_start_hour, window_end_hour)
  schedule at hour + random jitter

Capture

Playwright open portal

page.content()

hash

compare last snapshot

if diff significant:
notify

store snapshot

APPENDIX E — ADMIN UI ARCHITECTURE

Stack:

Next.js

TailwindCSS

shadcn/ui

React Query

Zustand (light state)

Layout

Sidebar:

Dashboard

Agents

Profiles

Portals

Jobs

HITL

Notifications

Watcher

Audit Logs

Settings

Agents UI

Card grid:

emoji 🤖

mode badge

profile badge

status dot

drag & drop support

bulk select checkbox

APPENDIX F — STAFF PORTAL

Login

My Tasks

OTP input modal

CAPTCHA input

History

Escalate

APPENDIX G — CI/CD PIPELINE

Stages:

Install

Typecheck

Unit Test

Build

Docker Build

Push

Deploy Test

Manual Approval

Deploy Prod

CURRENT STATUS CHECK

Telegram ✅
Email ✅
Slot detection ✅
STOP flow ✅
Dedupe ✅
FSM stable ✅

MVP core automation: hazır

Eksik:

Fake portal

CP DB migrations

CP API

Admin UI

Staff UI

Watcher

CI/CD

Docker env separation

1) Observability (MVP+): minimum ama düzgün
Standartlar

Structured logs: JSON (pino) + job_id, tenant_id, agent_id, portal_id, run_id, state, attempt, trace_id

Metrics: Prometheus endpoint (/metrics)

Health: liveness/readiness ayrımı

Tracing (opsiyonel): OpenTelemetry (sonra)

Worker metrics (örnek)

worker_jobs_processed_total{result=success|failed|cancelled}

worker_job_duration_seconds_bucket

worker_slot_found_total{portal_id}

worker_notify_sent_total{channel=telegram|email}

worker_notify_failed_total{channel}

worker_rate_limiter_wait_seconds_bucket

agent_heartbeat_age_seconds{agent_id} (CP tarafında)

API/CP metrics (örnek)

http_requests_total{route,method,status}

db_query_duration_seconds_bucket

queue_enqueue_total

hitl_tasks_created_total

Log shipping (single server)

MVP: docker logs + rotate

Sonra: Loki/Promtail veya ELK (sen daha sonra Grafana stack demiştin)

2) Endpoint seti (CP + HITL + Watcher) — eksiksiz liste

Not: path’leri /cp/* (admin/control plane) ve /api/* (public/job) diye ayır.

CP Auth

POST /cp/auth/login (basic -> session/jwt) (istersen sadece Basic Auth reverse-proxy ile de olabilir)

POST /cp/auth/logout

GET /cp/me

CP Agents

GET /cp/agents

POST /cp/agents (agent create or register)

PATCH /cp/agents/:id (enable/disable, mode sync/async, concurrency, portal assignment)

POST /cp/agents/bulk (apply profile to ALL/COUNT/PERCENT, enable/disable batch)

POST /cp/agents/:id/scale (single agent scale params – genelde pool-level olur)

POST /cp/agents/:id/heartbeat (worker -> CP)

CP Profiles

GET /cp/profiles

POST /cp/profiles

GET /cp/profiles/:id

PATCH /cp/profiles/:id

DELETE /cp/profiles/:id

CP Portals

GET /cp/portals

PATCH /cp/portals/:id (enable/disable, baseUrl, selectors version, pacing defaults)

POST /cp/portals/:id/assign (agents list / pools)

CP Notify

GET /cp/notify

PATCH /cp/notify (telegram/mail settings, enable/disable)

POST /cp/notify/test (send test telegram + test email)

HITL (personel portal için kritik)

GET /cp/hitl/tasks?status=pending

GET /cp/hitl/tasks/:id

POST /cp/hitl/tasks/:id/submit (OTP, captcha token, manual steps)

POST /cp/hitl/tasks/:id/assign (staff assignment)

POST /cp/hitl/tasks/:id/cancel

Jobs admin ops (CP)

GET /cp/jobs?status=&portal=&tenant=&limit=&offset=

GET /cp/jobs/:id

POST /cp/jobs/:id/stop

POST /cp/jobs/:id/retry

GET /cp/jobs/:id/events

GET /cp/jobs/:id/runs

Watcher (HTML dump + diff + notify)

GET /cp/watcher/config

PATCH /cp/watcher/config (active, windows, random jitter, portals scope)

POST /cp/watcher/run-now (manual trigger)

GET /cp/watcher/snapshots?portal_id=&from=&to=

GET /cp/watcher/snapshots/:id (html metadata + diff summary)

GET /cp/watcher/snapshots/:id/raw (restricted; ops only)

System

GET /cp/health/live

GET /cp/health/ready

GET /cp/system/status (db/redis/queue/agents)

GET /metrics

3) Docker / images / upgrades / security notları (3 env)
Image versioning & upgrades

Pinned versions (no latest)

CI pipeline:

build → tag: service:gitsha + service:semver

generate SBOM (syft) + vuln scan (grype/trivy)

Upgrade policy:

weekly/monthly dependency bump window

critical CVE hotfix path

Compose (dev/test/prod)

compose.dev.yml: bind mounts, hot reload, mock services

compose.test.yml: run E2E + fake visa portal container + ephemeral db

compose.prod.yml: no bind mounts, restart policies, resource limits, log rotation

Secrets

.env prod’de repo dışı (docker secrets veya OS env)

NOTIFY_ACTION_TOKEN, SMTP creds, Telegram token: never in client

Disable source maps in prod UI build.

**⚠️ MVP Security Note: Database Secrets**

Current MVP stores notification secrets (telegram_bot_token, smtp_pass, webhook_secret) in plaintext in notify_settings table. API responses redact these fields but DB breach would expose them.

**Post-MVP hardening required:**
- Encrypt-at-rest using KMS or libsodium envelope encryption
- Store only encrypted blobs in DB, decrypt at runtime with master key
- Implement master key rotation strategy
- Consider using external secrets manager (HashiCorp Vault, AWS Secrets Manager)

Network hardening

Services private network; only reverse proxy exposed

/cp/* only via VPN / IP allowlist / basic auth

Rate limit on CP endpoints

Node hardening

NODE_ENV=production

--enable-source-maps KAPALI

Helmet/CSP (admin UI)

Audit logs for admin actions

4) “compiled gizli kalsın” gerçeği

Web UI’da kodu gerçekten saklayamazsın. Yapılabilecek doğru şey:

secrets server-side

RBAC + logging + rate limit

sourcemap kapat + minify

security by design (obfuscation değil)

Customer Profiles (Critical) — Admin-managed, Staff-view (redacted)
Amaç

Otomasyonun “boşta kendiliğinden” değil, müşteri profiline bağlı çalışması.

Her müşteri için:

hangi portal(lar)

hangi visa type / başvuru parametreleri

iletişim bilgileri (notify hedefi)

özel durum flags (bool / enum)

run schedule / job policy (slot check sıklığı vs)

Sistem bu profile göre en uygun agent / agent pool seçip job’ları enqueue eder.

RBAC & Redaction

Admin/SuperAdmin: tam görüntü + edit + “gizli alanı göster” toggle

Staff: müşteri listesi + job/hitl bağlamı için gerekli alanlar redacted

örn: TR********34, fur***@mail.com, +90 5** *** ** 12

UI: “👁 Show/Hide sensitive” sadece adminlerde aktif.

Data model (öneri)

customers

id, tenant_id

display_name (ör: “Ahmet K.”)

tags (ops)

portal_id (default)

profile_id (customer-level profile: pacing/retry overrides)

status (active/paused)

notify_email (sensitive)

notify_phone (sensitive, opsiyonel)

created_at, updated_at

customer_secrets (ayrı tablo, erişim daha sıkı)

customer_id

passport_no / id_no (sensitive)

birth_date (sensitive)

extra_identity_fields (jsonb)

encryption: at-rest encryption (app-level veya DB-level)

customer_preferences (jsonb)

visa_type, appointment_city, preferred_dates_range, priority

special_flags:

has_previous_refusal (bool)

requires_otp_staff (bool)

needs_family_booking (bool)

has_travel_soon (bool)

use_proxy_location (bool) (opsiyonel)

slot_check_policy:

active_hours (time window)

jitter (random)

max_checks_per_day

cooldown_after_found

Job generation (scheduler)

CP tarafında bir Scheduler (cron-like):

GET /cp/scheduler/status

PATCH /cp/scheduler/config (windows, jitter, limits)

POST /cp/scheduler/run-now

Scheduler:

aktif müşterileri çeker

policy’ye göre “slot check job” üretir

queue’ya atar

Slot bulunduğunda:

notify (telegram + email)

gerekiyorsa HITL task create (OTP/CAPTCHA)

booking flow (MVP sonrası)

Agent selection (routing)

“Portal havuzu + profil uyumu” ile seç:

agent enabled

agent mode (sync/async)

agent assigned_portals contains customer.portal

agent current_load düşük

agent profile match / compatible

Seçim stratejisi (basit):

Weighted round-robin + load factor

Bulk assignment:

müşteri grubu (tag) → profile apply

% veya count ile agent subset’e apply (senin önceki ihtiyacınla uyumlu)

Endpoints (CP)

GET /cp/customers

POST /cp/customers

GET /cp/customers/:id

PATCH /cp/customers/:id

DELETE /cp/customers/:id (soft delete önerilir)

GET /cp/customers/:id/redacted (staff view)

POST /cp/customers/:id/pause / POST /cp/customers/:id/resume

POST /cp/customers/:id/run-slot-check (manual trigger)

GET /cp/customers/:id/jobs

GET /cp/customers/:id/hitl-tasks

UI (Admin & Staff)

Admin portal:

Customers list + filters (portal, status, tags, priority)

Customer detail:

profile editor

secrets toggle

“Run now” button

job history + events + notifications log
Staff portal:

Customers read-only + redacted

HITL tasks queue (primary)

Customer context minimal (isim, portal, job state, redacted contact)

“Trigger” mantığı netleştirme (tek cümle)

Prod’da jobların ana kaynağı Customer’dır; müşteri olmadan sadece system jobs çalışır (watcher/health/smoke).