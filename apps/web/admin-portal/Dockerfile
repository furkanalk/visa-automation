# Admin Portal (Next.js) - multi-stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock*.json ./
COPY apps/web/admin-portal/package.json apps/web/admin-portal/
RUN npm ci --workspace=@visa-automation/admin-portal

COPY apps/web/admin-portal apps/web/admin-portal
ARG NEXT_PUBLIC_CP_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_CP_API_URL=$NEXT_PUBLIC_CP_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build --workspace=@visa-automation/admin-portal

# Production runner (standalone)
FROM node:20-alpine AS production

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/admin-portal/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/admin-portal/.next/static ./apps/web/admin-portal/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/admin-portal/public ./apps/web/admin-portal/public

USER nextjs
EXPOSE 3002
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/web/admin-portal/server.js"]

# Development
FROM node:20-alpine AS development

WORKDIR /app

COPY package.json package-lock*.json ./
COPY apps/web/admin-portal apps/web/admin-portal
RUN npm ci

WORKDIR /app/apps/web/admin-portal
ENV NODE_ENV=development
EXPOSE 3002
CMD ["npm", "run", "dev", "--", "--port", "3002"]
