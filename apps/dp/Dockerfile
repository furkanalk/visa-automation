# Worker Dockerfile - Multi-stage build with Playwright
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/db/package*.json ./packages/db/
COPY apps/dp/package*.json ./apps/dp/

# Install dependencies (without Playwright browsers for build stage)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN --mount=type=cache,target=/root/.npm \
  npm ci --workspace=packages/shared --workspace=packages/db --workspace=apps/dp

# Copy source code
COPY tsconfig*.json ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/dp ./apps/dp

# Build
RUN find . -name "tsconfig.tsbuildinfo" -delete && \
    npm run build --workspace=packages/shared && \
    npm run build --workspace=packages/db && \
    npm run build --workspace=apps/dp

# Stage 2: Production with Playwright
FROM mcr.microsoft.com/playwright:v1.40.0-focal AS production

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Add non-root user (Playwright image has pwuser)
USER pwuser

WORKDIR /app

# Copy package files
COPY --chown=pwuser:pwuser package*.json ./
COPY --chown=pwuser:pwuser packages/shared/package*.json ./packages/shared/
COPY --chown=pwuser:pwuser packages/db/package*.json ./packages/db/
COPY --chown=pwuser:pwuser apps/dp/package*.json ./apps/dp/

# Install production dependencies only
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN --mount=type=cache,target=/root/.npm \
  npm ci --omit=dev --workspace=packages/shared --workspace=packages/db --workspace=apps/dp

# Copy built artifacts
COPY --chown=pwuser:pwuser --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --chown=pwuser:pwuser --from=builder /app/packages/db/dist ./packages/db/dist
COPY --chown=pwuser:pwuser --from=builder /app/apps/dp/dist ./apps/dp/dist

ENV NODE_ENV=production

CMD ["node", "apps/dp/dist/index.js"]

# Stage 3: Development (Debian base so Playwright browsers can be installed)
FROM node:20-bookworm-slim AS development

WORKDIR /app

# Install Playwright system deps (for Chromium)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/db/package*.json ./packages/db/
COPY apps/dp/package*.json ./apps/dp/

# Install all dependencies
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN --mount=type=cache,target=/root/.npm \
  npm ci

# Install Playwright Chromium at build time (in case no volume overwrites node_modules)
RUN npx playwright install chromium

# Entrypoint: ensure Chromium exists for current Playwright (e.g. after volume mount), then run command
COPY apps/dp/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Copy source
COPY tsconfig*.json ./
COPY packages ./packages
COPY apps/dp ./apps/dp

ENV NODE_ENV=development

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npm", "run", "dev", "--workspace=@visa-automation/dp"]
