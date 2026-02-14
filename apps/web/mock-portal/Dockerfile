# Mock Portal (Express) - multi-stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock*.json ./
COPY apps/web/mock-portal/package.json apps/web/mock-portal/
RUN npm ci --workspace=@visa-automation/mock-portal

COPY apps/web/mock-portal apps/web/mock-portal
RUN npm run build --workspace=@visa-automation/mock-portal

# Production
FROM node:20-alpine AS production

WORKDIR /app

RUN addgroup --system --gid 1001 app
RUN adduser --system --uid 1001 app

COPY --from=builder /app/package.json /app/package-lock*.json ./
COPY --from=builder /app/apps/web/mock-portal/package.json ./apps/web/mock-portal/
RUN npm ci --omit=dev --workspace=@visa-automation/mock-portal

COPY --from=builder --chown=app:app /app/apps/web/mock-portal/dist ./apps/web/mock-portal/dist
COPY --from=builder --chown=app:app /app/apps/web/mock-portal/public ./apps/web/mock-portal/public

USER app
WORKDIR /app/apps/web/mock-portal
ENV NODE_ENV=production
EXPOSE 3004
CMD ["node", "dist/index.js"]

# Development
FROM node:20-alpine AS development

WORKDIR /app

COPY package.json package-lock*.json ./
COPY apps/web/mock-portal apps/web/mock-portal
RUN npm ci

WORKDIR /app/apps/web/mock-portal
ENV NODE_ENV=development
EXPOSE 3004
CMD ["npm", "run", "dev"]
