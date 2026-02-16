# cp (control-plane API) Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/db/package*.json ./packages/db/
COPY apps/cp/package*.json ./apps/cp/

RUN --mount=type=cache,target=/root/.npm \
  npm ci --workspace=packages/shared --workspace=packages/db --workspace=apps/cp

COPY tsconfig*.json ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/cp ./apps/cp

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/db
RUN npm run build --workspace=apps/cp

# Production
FROM node:20-alpine AS production

RUN apk add --no-cache wget

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nodeuser -u 1001 -G nodejs

COPY --from=builder --chown=nodeuser:nodejs /app/package*.json ./
COPY --from=builder --chown=nodeuser:nodejs /app/packages/shared/package*.json ./packages/shared/
COPY --from=builder --chown=nodeuser:nodejs /app/packages/db/package*.json ./packages/db/
COPY --from=builder --chown=nodeuser:nodejs /app/apps/cp/package*.json ./apps/cp/

RUN --mount=type=cache,target=/root/.npm \
  npm ci --omit=dev --workspace=packages/shared --workspace=packages/db --workspace=apps/cp

COPY --from=builder --chown=nodeuser:nodejs /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=nodeuser:nodejs /app/packages/db/dist ./packages/db/dist
COPY --from=builder --chown=nodeuser:nodejs /app/apps/cp/dist ./apps/cp/dist

USER nodeuser
ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "apps/cp/dist/index.js"]

# Development (use BuildKit cache so npm ci is fast on rebuilds)
# docker buildx build or DOCKER_BUILDKIT=1
FROM node:20-alpine AS development

RUN apk add --no-cache wget

WORKDIR /app

COPY package*.json ./
COPY packages ./packages
COPY apps/cp ./apps/cp

RUN --mount=type=cache,target=/root/.npm \
  npm ci

ENV NODE_ENV=development
EXPOSE 3001

CMD ["npm", "run", "dev", "--workspace=@visa-automation/cp"]
