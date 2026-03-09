# VizeSelf — Current State and Weekend Checklist

## Current Status

### Product Status
Core product is largely in place:
- agent flow exists
- booking / scout logic exists
- portal structure exists
- admin / staff separation exists
- mock / test approach exists

### Overall Progress Estimate
- **Core product:** ~90%
- **Deployable MVP:** ~70%
- **Production hardening:** ~50%
- **General overall state:** **~75–80%**

This means the product is not at zero anymore. The main remaining work is **release hardening, deployment, access control, and final validation**.

---

## Target Architecture

### Public Entry Points
Only these should be exposed publicly through Caddy:
- `manager.vizeself.com` → `visa-admin-portal`
- `portal.vizeself.com` → `visa-staff-portal`
- `mock.vizeself.com` → `visa-mock-portal`

### Internal Only
These should remain internal and **must not be exposed publicly**:
- `visa-cp` (Control Plane API)
- `visa-dp` (Data Plane / worker)
- `postgres`
- `redis`

### Notes
- `api.vizeself.com` is **not required right now** unless there is a real external webhook / callback / action endpoint need.
- `cp`, `dp`, `postgres`, and `redis` do **not** need public DNS.
- Container-to-container communication can use Docker service names.

---

## Reverse Proxy and Exposure Model

### Why Caddy
Caddy is kept because it solves the original needs:
- single public entry point
- automatic HTTPS / TLS via Let's Encrypt
- simpler reverse proxy config
- only ports `80/443` exposed publicly
- better network isolation
- lightweight RAM footprint

### Public Routing Goal
All services remain internal except Caddy.

External access should only be through Caddy on:
- `80`
- `443`

### Final Intended Mapping
- `manager.vizeself.com` → `visa-admin-portal:3000`
- `portal.vizeself.com` → `visa-staff-portal:3000`
- `mock.vizeself.com` → `visa-mock-portal:3000`

`visa-cp` stays internal for now.

---

## Docker / Network Isolation

### Current Services
- `visa-dp` — Data Plane / worker
- `visa-cp` — Control Plane / API
- `visa-admin-portal`
- `visa-mock-portal`
- `visa-staff-portal`

### Network Design
Use two Docker networks:
- `edge`
- `backend`

### Rules
- `caddy` connected to both `edge` and `backend`
- all other services connected only to `backend`
- `visa-dp` must never connect to `edge`
- internal services must not publish ports publicly

### Important
Avoid public `ports:` on internal services.
Use either:
- `expose:`
- or nothing if same Docker network is enough

### Security Goal
- only Caddy is exposed to internet
- no direct access to `visa-cp`
- no direct access to `visa-dp`
- no direct access to internal-only services
- HTTPS terminates at Caddy

---

## Example Caddy Structure

```caddyfile
manager.vizeself.com {
    reverse_proxy visa-admin-portal:3000
}

portal.vizeself.com {
    reverse_proxy visa-staff-portal:3000
}

mock.vizeself.com {
    reverse_proxy visa-mock-portal:3000
}
```

If an external API / callback route is truly needed later, then a dedicated public API host can be added at that time.

---

## Important Config Notes

### Public URL Handling
Review and finalize these carefully:
- any public callback URL
- any webhook URL
- Telegram action URLs
- booking redirection URLs

### Telegram Constraint
`canUseTelegramActionButtons` requires:
- HTTPS
- non-localhost URL

This is enforced by Telegram itself.

So:
- in dev, inline action buttons may not appear
- this is expected if `notify_action_base_url` is unset or points to `http://localhost...`
- this limitation cannot be bypassed from the app side

### Important Outcome
Dev environment not showing Telegram inline buttons is **normal**.
This is not a bug if the URL is not HTTPS and non-localhost.

---

## Weekend Main Plan

### Phase 1 — Release / Deployment Foundation
- prepare git repo cleanly
- prepare image registry
- push git and image
- finalize CI/CD
- add Caddy
- apply network isolation
- deploy to server

### Phase 2 — Secure Access
- install WireGuard
- test VPN
- add users / peers

### Phase 3 — Stabilization and Final Validation
- fix portal issues
- add missing admin portal functionality
- test more until the Sunday evening meeting

### Important Execution Rule
Do not open new large features during this pass.
Focus on:
- deployment
- exposure model
- access control
- critical runtime correctness
- final validation

---

## Detailed Checklist

### A. Access Control / Staff / Admin

#### Role Editing Rules
- only `super_admin` can edit **admin** accounts
- admins can edit **staff** accounts
- admins must **not** be able to edit other admin accounts

#### Password Visibility / Edit Rules
- password field should only be editable by `super_admin`
- password field should only be visible to `super_admin`
- all other roles must see redacted value such as `****`
- `super_admin` should have an eye icon to show / hide password field values

#### Suspend Behavior
- verify that suspend truly blocks login
- suspended user should receive a message like:
  - `This account is suspended. Contact administrator for help.`

---

### B. Portal UI / UX / Runtime Checks

#### Portals Tab
- portals list should show:
  - rate limit enabled / disabled
  - OTP mode
  - CAPTCHA mode
- revert portal color styling back to previous version
- keep visible URL area because current version is liked

#### Additional Runtime Checks
- check draining behavior
- mouse should move multiple times; verify via mock server logs
- verify minimum 40-second rule (`minRunDurationMs: 40000`)
- confirm `40.1` style runtime passes correctly
- when snapshot history is cleaned, archived entries should also be cleaned
- verify booking redirection page URL
- test headless booking on page 2

---

### C. Booking / Scout Logic Fixes

#### 1. Scout False Positive — Travel Date Window Filter

**Problem**
Scout portal scans `today + 90` and does not consider customer `travel_date` directly.
When it finds a slot, it creates jobs for **all active customers**.
But the valid appointment window is:
- `[travelDate - 45, travelDate - 15]`

So found dates may be outside the valid customer window and booking agent works unnecessarily.

**Where**
- `watcher.ts`
- `POST /slot-open`

**Required Fix**
Before creating a customer job, check whether:
- `open_dates`
- and customer appointment window
intersect.

**Plan**
- at `callSlotOpen` / `/slot-open`, for each customer, intersect `res.dates` with `[travelDate-45, travelDate-15]`
- if there is no match, do not create a job for that customer
- at booking agent `SLOT_SEARCHING` entry, if the slot is out of valid window, return early with `WAITING_SLOT`

#### 2. Booking Agent `runStageB (locator.click())` Validation

**Problem**
jQuery synthetic click issue was previously handled, but booking path with `slotCheckOnly=false` has not been fully validated.

**Required Test**
Run a job in mock portal with:
- `slotCheckOnly=false`

Observe logs for:
- `runStageB: clicked day cell via locator`
- `hasRealSlot:true`

---

### D. Infrastructure / Deployment / Long-Term But Needed Now

#### MVP / Deployment Work
- Agent test final
- Docker image + CI/CD
- prepare local Caddy config
- minimal deploy to server (`Caddy + API/portals` model)
- WireGuard at the end

#### MVP Aftermath / Later
- Staff improvements later
- Auth (`register/login`) later

#### Additional Infra Items
- verify mouse movement logs (`mouseMoveIntervalMs`)
- verify 40-second minimum runtime enforcement
- payments tab is future work for admin portal
- headless page 2 testing remains in validation set

---

## Deployment Notes

### Compose Changes
Add Caddy service as public reverse proxy and TLS terminator.

Typical shape:

```yaml
services:
  caddy:
    image: caddy:2-alpine
    container_name: caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./infra/caddy/Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - visa-admin-portal
      - visa-staff-portal
      - visa-mock-portal
    networks:
      - edge
      - backend
```

### Internal Services
Internal services must not expose public ports.
Replace patterns like:

```yaml
ports:
  - "8000:8000"
```

with:

```yaml
expose:
  - "8000"
```

or remove completely if same network access is enough.

---

## Final Recommended Order

1. stabilize repo / image / CI/CD
2. harden Docker Compose
3. add Caddy and network isolation
4. deploy to server
5. verify public routing works
6. install WireGuard and test access
7. fix portal / admin critical issues
8. run booking / scout / runtime checks
9. do final smoke testing before the Sunday meeting

---

✅ Tamamlanan Adımlar
Adım	Durum
1. Stabilize repo / CI/CD	✅ stage.yml + deploy.yml düzeltildi, validate.yml devre dışı
2. Harden Docker Compose	✅ postgres/redis port'ları kapatıldı, prod-override temizlendi
3. Caddy + network isolation	✅ Caddyfile hazır, edge/backend network var, /cp/ proxy var
7. Portal / Admin Critical Issues	✅ Badge'ler eklendi, suspend OK, password visibility OK
8. Booking / Scout / Runtime	✅ FSM fix (shared dist build), scout akışı doğrulandı, 40s OK

🔲 Kalan Adımlar

Adım 4 — Sunucuya Deploy (ELLE YAPILACAK)
```
1. Sunucuda Docker + Docker Compose kurulu olmalı
2. GitHub Secrets set edilmeli:
   - PROD_SSH_HOST
   - PROD_SSH_USER
   - PROD_SSH_KEY
   - PROD_SSH_PORT
3. GHCR PAT: Settings → Developer Settings → PAT (read:packages)
   → sunucuda: docker login ghcr.io
4. DNS: A record → manager/portal/mock.vizeself.com → sunucu IP
5. Sunucuda repo clone: git clone ... /opt/visa-automation
6. .env.prod dosyasını sunucuya koy (git'te yok, elle kopyalanacak)
7. İlk deploy: git push master → CI otomatik tetiklenir
```

Adım 5 — Public Routing Doğrula (DEPLOY SONRASI)
```bash
curl -I https://manager.vizeself.com
curl -I https://portal.vizeself.com
curl -I https://mock.vizeself.com
```

Adım 6 — WireGuard (Sunday meeting'i BLOKLAMIYOR, sonraya bırakılabilir)

Adım 9 — Sunday Smoke Test
- Deploy çalışıyorsa bu kendiliğinden gelir

iDObsmhK4O4xfVkR8VTRl4JYpYYTZQXywDi/zMEUsHo=
4UYNKh8XtPIy+B9FiL/PLy4+pQu5yuUFYy66qVLL8T8=

client1.key = Windows client private key

client1.pub = server config’e girecek public key