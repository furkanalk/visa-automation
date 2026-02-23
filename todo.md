1) Agent Start / Complete Notifications (English, improved format)

We need to refactor agent lifecycle notifications.

Current Example

Start:

Agent started
Job: 96152232-6b3e-4058-85d5-950b49b8d94b · Run: 8ecd568f-70eb-41fb-b53c-94b7fc8283bd
Portal: as-visa
Agent: agent-asvisa-scout
Visa: SCHENGEN · Priority: 1

Complete:

Agent completed
Job: 96152232-6b3e-4058-85d5-950b49b8d94b · Run: 8ecd568f-70eb-41fb-b53c-94b7fc8283bd
Portal: as-visa
Agent: agent-asvisa-scout
Status: slot_found
Halted at SLOT_FOUND (MVP)
Required Changes

All notifications must be in English.

Add clear emojis:

🚀 for started

✅ for completed (success)

❌ for failed

Improve formatting:

Put Run on a separate line (not next to Job)

Remove “(MVP)” from user-facing messages

Add failure notification format.

Target Format
🚀 Agent Started
🚀 Agent Started

Job: 96152232-6b3e-4058-85d5-950b49b8d94b
Run: 8ecd568f-70eb-41fb-b53c-94b7fc8283bd
Portal: as-visa
Agent: agent-asvisa-scout
Visa: SCHENGEN
Priority: 1
✅ Agent Completed (Slot Found)
✅ Agent Completed

Job: 96152232-6b3e-4058-85d5-950b49b8d94b
Run: 8ecd568f-70eb-41fb-b53c-94b7fc8283bd
Portal: as-visa
Agent: agent-asvisa-scout
Final Status: SLOT_FOUND

Remove:

Halted at SLOT_FOUND (MVP)

Any reference to MVP in notifications

❌ Agent Failed

If job ends in:

FAILED_RETRYABLE

FAILED_TERMINAL

FAILED_PROXY_LOST

any unexpected error

Format:

❌ Agent Failed

Job: {jobId}
Run: {runId}
Portal: {portalId}
Agent: {agentId}
Final Status: {status}
Reason: {errorMessage or failure_reason}
2) Watcher + Multiple Scout Agents Behavior

Clarification needed:

If a portal has 2 or more scout agents assigned:

Do they work concurrently?

Or do they pull jobs sequentially from the same queue?

Expected design:

Watcher enqueues jobs normally.

All scout agents listening to the same queue compete for jobs.

Redis/BullMQ ensures only one agent processes a job (lease-based).

If there are multiple scout agents, they process different jobs in parallel (not the same job).

Ensure:

No duplicate processing of same watcher job.

Proper lease locking.

Visibility in logs which agent picked which job.

3) Telegram ACK Button

We need to verify:

Do all relevant Telegram notifications include ACK?

Specifically:

Slot Found

Agent lifecycle

Booking confirmed

If missing, add ACK button.

Button behavior:

Signed URL (HMAC-based)

Goes to /api/jobs/{id}/ack

Must include ts, nonce, sig

Placement:

Either top or bottom of message

Prefer bottom under message body

Example:

[✅ ACK]

Ensure:

Signed link verification implemented

10-minute expiration

Event logged as NOTIFY_ACK

4) Slot Found Notification Not Sent (Watcher)

We need to confirm:

Are we still sending Telegram notification when slot is found inside watcher flow?

It must:

Send Slot Found notification

Include:

job

portal

tenant

dates

base URL

Include ACK button

If it was removed accidentally during refactor, re-enable it.

Watcher flow:
SLOT_SEARCHING → SLOT_FOUND
→ notifySlotFound()
→ halt job

Notification must still be triggered.


5) Current Services

We have the following containers:

visa-dp (Data Plane – worker)

visa-cp (Control Plane – API)

visa-admin-portal

visa-mock-portal

visa-staff-portal

We want to introduce Caddy as the public reverse proxy and TLS terminator.

5.1) Target Public Routing

All services must remain internal except Caddy.

External access only via Caddy (ports 80/443).

Domain Mapping

Example subdomains:

api.example.com → visa-cp

admin.example.com → visa-admin-portal

staff.example.com → visa-staff-portal

mock.example.com → visa-mock-portal

visa-dp must NOT be publicly exposed.

5.2) Docker Compose Changes

Add Caddy service:

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
      - visa-cp
      - visa-admin-portal
      - visa-staff-portal
      - visa-mock-portal
    networks:
      - edge
      - backend

Internal services must NOT expose ports publicly:

Remove things like:

ports:
  - "8000:8000"

They should only use:

expose:
  - "8000"

(or nothing, if same network)

5.3) Example Caddyfile
api.example.com {
    reverse_proxy visa-cp:8000
}

admin.example.com {
    reverse_proxy visa-admin-portal:3000
}

staff.example.com {
    reverse_proxy visa-staff-portal:3000
}

mock.example.com {
    reverse_proxy visa-mock-portal:3000
}

Notes:

Caddy automatically handles HTTPS via Let’s Encrypt.

No manual cert management needed.

Ensure DNS A record points to server IP.

5.4) Network Isolation

We want two networks:

networks:
  edge:
  backend:

Caddy connected to both edge and backend

Other services connected only to backend

visa-dp must never connect to edge

5.5) Security Goals

Only Caddy exposed to internet

No direct access to:

visa-cp

visa-dp

portals

Automatic HTTPS

Minimal RAM footprint (Caddy is lightweight)

5.6) Important

Ensure:

NOTIFY_ACTION_BASE_URL updated to public domain (api.example.com)

Webhooks / Telegram signed ACK links use public URL

No service binds to 0.0.0.0 externally except Caddy