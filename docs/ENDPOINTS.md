# API Endpoints

All routes are served by the CP API (default port 3001). Control-plane routes require `x-tenant-id` header. Public job routes use `x-tenant-id` for create/list/get; stop/ack use `?token=NOTIFY_ACTION_TOKEN`.

---

## Health & system (no tenant)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cp/health` | Health summary |
| GET | `/cp/health/live` | Liveness probe |
| GET | `/cp/health/ready` | Readiness (DB + Redis) |
| GET | `/cp/metrics` | Metrics (Prometheus-style) |
| GET | `/cp/system/status` | System status |
| GET | `/cp/system/config` | Public config (e.g. feature flags) |

---

## Public job API (`/api/jobs`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/jobs` | `x-tenant-id` | Create job (body: portal_id, visa_type, applicant, config, etc.) |
| GET | `/api/jobs` | `x-tenant-id` | List jobs (?limit, ?offset) |
| GET | `/api/jobs/:id` | `x-tenant-id` | Get job (tenant-isolated) |
| GET | `/api/jobs/:id/stop` | `?token=` | Telegram stop action |
| GET | `/api/jobs/:id/ack` | `?token=` | Telegram ack action (?event=) |

---

## Control-plane (require `x-tenant-id`)

### Agents (`/cp/agents`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cp/agents` | List (?status, mode, portal_id, profile_id, limit, offset) |
| GET | `/cp/agents/:id` | Get by ID |
| POST | `/cp/agents` | Create |
| PATCH | `/cp/agents/:id` | Update |
| DELETE | `/cp/agents/:id` | Delete |
| POST | `/cp/agents/:id/heartbeat` | Agent heartbeat |
| POST | `/cp/agents/bulk-assign-profile` | Bulk assign profile |
| POST | `/cp/agents/scale` | Scale agents (async/sync counts) |

### Profiles (`/cp/profiles`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cp/profiles` | List (?limit, offset) |
| GET | `/cp/profiles/default` | Default profile |
| GET | `/cp/profiles/:id` | Get by ID |
| POST | `/cp/profiles` | Create |
| PATCH | `/cp/profiles/:id` | Update |
| DELETE | `/cp/profiles/:id` | Delete |

### Portals (`/cp/portals`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cp/portals` | List (?enabled, limit, offset) |
| GET | `/cp/portals/by-portal-id/:portalId` | Get by portal_id |
| GET | `/cp/portals/:id` | Get by ID |
| POST | `/cp/portals` | Create |
| PATCH | `/cp/portals/:id` | Update |
| DELETE | `/cp/portals/:id` | Delete |
| POST | `/cp/portals/:id/assign-agents` | Assign agents (body: agent_ids) |
| POST | `/cp/portals/:id/enable` | Enable |
| POST | `/cp/portals/:id/disable` | Disable |

### Notify (`/cp/notify`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cp/notify` | Get notification settings (redacted) |
| PATCH | `/cp/notify` | Update settings |
| POST | `/cp/notify/test/telegram` | Test Telegram (body: chat_id?, message?) |
| POST | `/cp/notify/test/email` | Test email (body: to?, subject?, body?) |
| POST | `/cp/notify/test/webhook` | Test webhook (body: payload?) |

**DP internal (same prefix, different auth):**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/cp/notify/worker` | `X-Internal-Secret` (match CP_INTERNAL_SECRET), `x-tenant-id` | Full notify settings for DP worker (no redaction) |

### Watcher (`/cp/watcher`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cp/watcher` | Get watcher config |
| PATCH | `/cp/watcher` | Update config |
| POST | `/cp/watcher/run-now` | Trigger run (body: portal_ids?, force?) |
| GET | `/cp/watcher/snapshots` | List snapshots (?portal_id, from, to, severity, limit, offset) |
| GET | `/cp/watcher/snapshots/:id` | Get snapshot |
| GET | `/cp/watcher/snapshots/:id/html` | Get snapshot HTML |
| GET | `/cp/watcher/diffs/latest` | Latest diff (?portal_id) |
| GET | `/cp/watcher/status` | Watcher status |

### Audit (`/cp/audit`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cp/audit/summary` | Summary (?from, ?to) |
| GET | `/cp/audit/recent` | Recent activity (?limit) |
| GET | `/cp/audit/export` | Export (?from, to, format=csv|json) |
| GET | `/cp/audit` | List (?actor_type, action, resource_type, resource_id, from, to, limit, offset) |
| GET | `/cp/audit/:id` | Get by ID |

### Jobs (`/cp/jobs`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cp/jobs` | List (?status, visa_type, limit, offset) |
| POST | `/cp/jobs/batch-status` | Batch status (body: ids[]) |
| GET | `/cp/jobs/:id` | Get by ID |
| POST | `/cp/jobs/:id/stop` | Stop/cancel (body: reason?) |
| POST | `/cp/jobs/:id/retry` | Retry failed job |
| POST | `/cp/jobs/:id/requeue` | Requeue |
| GET | `/cp/jobs/:id/events` | Job events (?limit) |
| GET | `/cp/jobs/:id/runs` | Job runs |

### HITL (`/cp/hitl`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cp/hitl` | List tasks (?status, type, limit, offset) |
| GET | `/cp/hitl/pending-count` | Pending count |
| GET | `/cp/hitl/job/:jobId` | Tasks for job |
| GET | `/cp/hitl/:id` | Get task |
| POST | `/cp/hitl/:id/assign` | Assign (body: assigned_to) |
| POST | `/cp/hitl/:id/resolve` | Resolve (body: resolution) |
| POST | `/cp/hitl/:id/cancel` | Cancel |

### Settings (`/cp/settings`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cp/settings` | All settings (?category); 304 if X-Config-Updated-At matches |
| GET | `/cp/settings/list` | Flat list (?category) |
| GET | `/cp/settings/categories` | Categories |
| GET | `/cp/settings/:category/:key` | Get value |
| PUT | `/cp/settings/:category/:key` | Set value (body: value, description?) |
| PATCH | `/cp/settings/bulk` | Bulk update (body: updates[]) |
| DELETE | `/cp/settings/:category/:key` | Delete tenant override |
| GET | `/cp/settings/global` | Global settings (admin) |
| PUT | `/cp/settings/global/:category/:key` | Set global (super admin) |

### Customers (`/cp/customers`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cp/customers` | List (filters: status, portal_id, profile_id, tags, search, priority_min/max, limit, offset) |
| GET | `/cp/customers/counts` | Counts by status |
| GET | `/cp/customers/redacted` | List redacted (staff) |
| POST | `/cp/customers` | Create |
| GET | `/cp/customers/:id` | Get (?include_secrets=true) |
| GET | `/cp/customers/:id/redacted` | Redacted view |
| PATCH | `/cp/customers/:id` | Update |
| DELETE | `/cp/customers/:id` | Delete (?hard=true) |
| POST | `/cp/customers/:id/pause` | Pause |
| POST | `/cp/customers/:id/resume` | Resume |
| GET | `/cp/customers/:id/secrets` | Get secrets |
| PUT | `/cp/customers/:id/secrets` | Update secrets |
| GET | `/cp/customers/:id/jobs` | Customer jobs (stub) |
| POST | `/cp/customers/:id/run-slot-check` | Trigger slot check |
| POST | `/cp/customers/bulk` | Bulk (body: action, ids[], profile_id?, status?) |

### Staff (`/cp/staff`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cp/staff` | List (?status, role, search, limit, offset) |
| GET | `/cp/staff/notifications` | Notifications feed (stub) |
| POST | `/cp/staff/notifications/:id/read` | Mark read (stub) |
| GET | `/cp/staff/:id` | Get by ID |
| POST | `/cp/staff` | Create |
| PATCH | `/cp/staff/:id` | Update |
| DELETE | `/cp/staff/:id` | Delete |
| GET | `/cp/staff/activity` | Activity log (?staff_id, action, resource_type, start_date, end_date, limit, offset) |
| GET | `/cp/staff/:id/activity` | Activity for member |
| GET | `/cp/staff/dashboard` | Dashboard stats |
| GET | `/cp/staff/leaderboard` | Leaderboard (?period=today|week|month|all) |
| GET | `/cp/staff/online` | Online staff |
| POST | `/cp/staff/:id/suspend` | Suspend |
| POST | `/cp/staff/:id/activate` | Activate |
