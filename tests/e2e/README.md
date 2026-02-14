# E2E tests (Pillar 10)

End-to-end scenarios against the mock portal. **You run these yourself** (CP, DP, mock-portal, Redis, Postgres must be up).

## Prerequisites

1. Start infrastructure: Postgres, Redis.
2. Start CP: `npm run dev:cp` (port 3001).
3. Start DP: `npm run dev:dp` (with `USE_MOCK_PORTAL=true`, `MOCK_PORTAL_URL=http://localhost:3004` or similar).
4. Start mock-portal: `npm run dev:mock` (port 3004).

## Run

From repo root:

```bash
cd tests/e2e
npm install
npm run e2e          # all scenarios
npm run e2e:happy   # happy path only
npm run e2e:hitl    # HITL flow only
npm run e2e:retry   # timeout/retry only
```

Optional env: `E2E_BASE_URL`, `E2E_MOCK_PORTAL_URL`, `E2E_TENANT_ID`.

## Scenarios

| Scenario       | Description |
|----------------|-------------|
| **happy-path** | Mock returns slots; create job → assert SLOT_FOUND or COMPLETED. |
| **hitl**       | Mock triggers HITL; resolve via CP; assert job continues. |
| **timeout-retry** | Mock delay/error; job retries; assert eventual success or retry state. |

Deterministic mock data (fixed dates) is set in each scenario via mock-portal admin API.
