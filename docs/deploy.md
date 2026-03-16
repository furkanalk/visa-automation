# Sunucu Kurulum Kılavuzu

## 1. Ön Koşullar

Sunucuda sadece şunlar olmalı:

```sh
# Docker Engine
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Yeniden oturum aç (grup değişikliği için)

# Docker Compose plugin (Docker Engine ile genellikle gelir, kontrol et)
docker compose version
```

---

## 2. DNS Kayıtları

Domain sağlayıcında 3 adet A kaydı oluştur (Caddy otomatik TLS alır):

| Record | Hedef |
|--------|-------|
| `manager.vizeself.com` | sunucu IP |
| `portal.vizeself.com` | sunucu IP |
| `mock.vizeself.com` | sunucu IP |

---

## 3. GitHub Secrets (Repo → Settings → Secrets → Actions)

| Secret | Değer |
|--------|-------|
| `PROD_SSH_HOST` | Sunucu IP veya hostname |
| `PROD_SSH_USER` | SSH kullanıcısı (örn. `ubuntu`) |
| `PROD_SSH_KEY` | Private key içeriği (PEM, `-----BEGIN...`) |
| `PROD_SSH_PORT` | SSH portu (varsayılan `22`, opsiyonel) |

SSH key üretmek için (local makinede):
```sh
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/github_deploy
# Public key'i sunucuya ekle:
ssh-copy-id -i ~/.ssh/github_deploy.pub user@sunucu-ip
# Private key içeriğini PROD_SSH_KEY secret'ına yapıştır:
cat ~/.ssh/github_deploy
```

---

## 4. GitHub Environments (Repo → Settings → Environments)

İki environment oluştur:

- **`production-auto`** — onay yok (her push'ta otomatik deploy)
- **`production`** — Required reviewers ekle (manuel onay isteniyorsa)

Hangisinin aktif olduğunu Repo → Settings → Variables → Actions'dan kontrol et:
- `DEPLOY_REQUIRE_APPROVAL = false` → `production-auto` (otomatik)
- `DEPLOY_REQUIRE_APPROVAL = true` → `production` (onaylı)

---

## 5. .env.prod Dosyası (Sunucuda)

Sunucuya SSH ile bağlan, **bir kere** yap:

```sh
mkdir -p ~/visa-automation-env

# .env.prod.example dosyasını referans al (repoda mevcut):
# infra/docker/prod/.env.prod.example

cat > ~/visa-automation-env/.env.prod << 'EOF'
# --- Bootstrap super_admin ---
BOOTSTRAP_ADMIN_EMAIL=superadmin@vizeself.local
BOOTSTRAP_ADMIN_PASSWORD=BURAYA_GUCLU_SIFRE
BOOTSTRAP_ADMIN_NAME=System Administrator

# --- Database ---
DB_HOST=postgres
DB_PORT=5432
DB_NAME=visa_automation
DB_USER=postgres
DB_PASSWORD=BURAYA_GUCLU_DB_SIFRESI

# --- Redis ---
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=BURAYA_GUCLU_REDIS_SIFRESI

# --- App ---
LOG_LEVEL=info
CORS_ORIGIN=https://manager.vizeself.com
WORKER_ID=worker-1
TENANT_ID=default

# --- Internal ---
CP_API_URL=http://cp:3001
PUBLIC_API_URL=http://cp:3001
CP_INTERNAL_SECRET=BURAYA_OPENSSL_CIKTISI
# openssl rand -base64 32

# --- Frontends ---
NEXT_PUBLIC_CP_API_URL=https://manager.vizeself.com
NEXT_PUBLIC_STAFF_CP_API_URL=https://portal.vizeself.com
NEXT_PUBLIC_API_URL=https://manager.vizeself.com
ADMIN_PORTAL_URL=https://manager.vizeself.com

# --- Mock Portal ---
USE_MOCK_PORTAL=true
MOCK_PORTAL_BASE_URL=http://mock-portal:3004

# --- Image tags (CI override eder, elle çalıştırmak için fallback) ---
IMAGE_BOOTSTRAP=ghcr.io/GITHUB_KULLANICIN/visa-bootstrap:latest
IMAGE_CP=ghcr.io/GITHUB_KULLANICIN/visa-cp:latest
IMAGE_DP=ghcr.io/GITHUB_KULLANICIN/visa-dp:latest
IMAGE_ADMIN_PORTAL=ghcr.io/GITHUB_KULLANICIN/visa-admin-portal:latest
IMAGE_STAFF_PORTAL=ghcr.io/GITHUB_KULLANICIN/visa-staff-portal:latest
IMAGE_MOCK_PORTAL=ghcr.io/GITHUB_KULLANICIN/visa-mock-portal:latest
EOF

chmod 600 ~/visa-automation-env/.env.prod
```

> **Not:** `GITHUB_KULLANICIN` yerine GitHub kullanıcı adını yaz (lowercase).  
> `BURAYA_*` alanlarını gerçek değerlerle doldur.  
> Bu dosyaya bir daha dokunmak zorunda kalmayacaksın.

---

## 6. İlk Deploy

GitHub Actions → **Stage** workflow'u tetikle (master'a push yap veya elle çalıştır).  
Stage başarıyla bitince → **Deploy** workflow'u otomatik başlar.

Deploy workflow şunları yapar:
1. `infra/docker/prod/` ve `infra/caddy/` dosyalarını `~/visa-automation-infra/` altına `scp` ile kopyalar
2. SSH ile bağlanır, GHCR'dan image'ları çeker, container'ları başlatır
3. Bootstrap container çalışır → migration'lar koşar → super_admin oluşturulur → container kapanır

---

## 7. Doğrulama

```sh
# Sunucuda:
cd ~/visa-automation-infra/infra/docker/prod
docker compose --env-file ~/visa-automation-env/.env.prod \
  -f compose.yml -f prod-override.yml ps
```

Tüm servisler `Up` olmalı: `postgres`, `redis`, `cp`, `dp`, `caddy`, `admin-portal`, `staff-portal`, `mock-portal`.  
`bootstrap` → `Exited (0)` olmalı (migration bitince kapanır, bu normal).

Tarayıcıdan kontrol:
- https://manager.vizeself.com → Admin portal
- https://portal.vizeself.com → Staff portal
- https://mock.vizeself.com → Mock portal

---

## Sonraki Push'larda

Her `master` push'u otomatik olarak:
- Stage → build + GHCR push
- Deploy → scp + pull + rolling restart

**Sunucuda git yok, repo klonu yok, git pull yok.**  
`.env.prod` hiç dokunulmaz, `~/visa-automation-env/.env.prod`'da güvende kalır.