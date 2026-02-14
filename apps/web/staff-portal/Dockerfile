# Staff Portal (Next.js) - multi-stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock*.json ./
COPY apps/web/staff-portal/package.json apps/web/staff-portal/
RUN npm ci --workspace=@visa-automation/staff-portal

COPY apps/web/staff-portal apps/web/staff-portal
ARG NEXT_PUBLIC_CP_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_CP_API_URL=$NEXT_PUBLIC_CP_API_URL
RUN npm run build --workspace=@visa-automation/staff-portal

# Production runner (standalone)
FROM node:20-alpine AS production

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/staff-portal/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/staff-portal/.next/static ./apps/web/staff-portal/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/staff-portal/public ./apps/web/staff-portal/public

USER nextjs
EXPOSE 3003
ENV PORT=3003
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/web/staff-portal/server.js"]

# Development
FROM node:20-alpine AS development

WORKDIR /app

COPY package.json package-lock*.json ./
COPY apps/web/staff-portal apps/web/staff-portal
RUN npm ci

WORKDIR /app/apps/web/staff-portal
ENV NODE_ENV=development
EXPOSE 3003
CMD ["npm", "run", "dev", "--", "-p", "3003"]
