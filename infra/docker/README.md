# Visa Automation – Docker

Ortamlar **dev**, **test**, **prod** için ayrı klasörler; her birinde kendi `compose.yml` ve `.env.example`. Ortak servis tanımları **services/** altında.

## Yapı

```
infra/docker/
├── dev/           # Lokal geliştirme
│   ├── compose.yml
│   └── .env.example
├── test/          # CI E2E (Validate workflow) + isteğe bağlı lokal E2E
│   ├── compose.yml
│   └── .env.example
├── prod/          # Production (sunucuda çalıştırılır)
│   ├── compose.yml
│   └── .env.example
├── services/      # Ortak servis tanımları (postgres, redis, cp, dp, admin-portal, staff-portal, mock-portal)
└── README.md
```

## Dev

```bash
cd infra/docker/dev
cp .env.example .env
# İsteğe bağlı: .env düzenle
docker compose up -d
```

Veya repo root’tan: **`npm run docker:up`** (dev klasörüne gidip `.env` oluşturup compose çalıştırır).

Portlar: Postgres 5432, Redis 6379, CP 3001, Admin 3002, Staff 3003, Mock 3004.

Hot reload için admin/staff portallarını host’ta çalıştır: `npm run dev:admin-portal`, `npm run dev:staff-portal`.

## Test (CI / lokal E2E)

Validate workflow E2E için **infra/docker/test** kullanır. Lokal E2E debug:

```bash
cd infra/docker/test
cp .env.example .env
docker compose up -d
# npm run e2e
docker compose down -v
```

## Prod

```bash
cd infra/docker/prod
cp .env.example .env
# .env içinde DB_PASSWORD, REDIS_PASSWORD, NOTIFY_ACTION_TOKEN, CORS, SMTP, Telegram doldur
export IMAGE_CP=ghcr.io/your-org/visa-cp:main
export IMAGE_DP=...
export IMAGE_ADMIN_PORTAL=...
export IMAGE_STAFF_PORTAL=...
docker compose pull
docker compose up -d
```

Prod compose: **no-new-privileges**, **cap_drop**, **read_only** (uygulama container’ları), non-root kullanıcılar.

## CI/CD (GitHub Actions)

**Akış:** Push to main → **Stage** (build + push) → **[Kapı 1]** → **Validate** (testler; E2E için test stack) → **[Kapı 2]** → **Deploy** (komutları yazdırır).

**Onay kapıları:** Repo variable **VALIDATE_REQUIRE_APPROVAL** / **DEPLOY_REQUIRE_APPROVAL** = `true` → ilgili Environment’ta Required reviewers gerekir. `false` veya unset → **test-auto** / **production-auto** (onaysız). Environments: **test**, **test-auto**, **production**, **production-auto**.

## Build context

Servis dosyalarındaki `build.context` repo root’u işaret eder. Compose’u ilgili ortam klasöründen çalıştır: `infra/docker/dev`, `infra/docker/test`, `infra/docker/prod`.
