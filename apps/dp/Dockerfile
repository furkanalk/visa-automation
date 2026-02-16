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
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/db
RUN npm run build --workspace=apps/dp

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

# Stage 3: Development
FROM node:20-alpine AS development

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/db/package*.json ./packages/db/
COPY apps/dp/package*.json ./apps/dp/

# Install all dependencies (skip Playwright in dev mode for speed)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN --mount=type=cache,target=/root/.npm \
  npm ci

# Copy source
COPY tsconfig*.json ./
COPY packages ./packages
COPY apps/dp ./apps/dp

ENV NODE_ENV=development

CMD ["npm", "run", "dev", "--workspace=@visa-automation/dp"]
