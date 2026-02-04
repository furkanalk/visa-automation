# API Dockerfile - Multi-stage build
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/db/package*.json ./packages/db/
COPY apps/api/package*.json ./apps/api/

# Install dependencies
RUN npm ci --workspace=packages/shared --workspace=packages/db --workspace=apps/api

# Copy source code
COPY tsconfig*.json ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/api ./apps/api

# Build
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/db
RUN npm run build --workspace=apps/api

# Stage 2: Production
FROM node:20-alpine AS production

# Add non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/db/package*.json ./packages/db/
COPY apps/api/package*.json ./apps/api/

# Install production dependencies only
RUN npm ci --omit=dev --workspace=packages/shared --workspace=packages/db --workspace=apps/api

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Set ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health/live || exit 1

CMD ["node", "apps/api/dist/index.js"]

# Stage 3: Development (for hot reload)
FROM node:20-alpine AS development

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/db/package*.json ./packages/db/
COPY apps/api/package*.json ./apps/api/

# Install all dependencies
RUN npm ci

# Copy source
COPY tsconfig*.json ./
COPY packages ./packages
COPY apps/api ./apps/api

ENV NODE_ENV=development
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "dev", "--workspace=apps/api"]
