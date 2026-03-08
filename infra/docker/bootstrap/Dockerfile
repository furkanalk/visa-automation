# Bootstrap image: runs DB migrations + creates initial super_admin.
# Built by Stage CI and pushed to GHCR as visa-bootstrap.
# No repo mount needed on the server — everything is baked in.
FROM postgres:16-alpine

RUN apk add --no-cache bash

# Copy migration SQL files
COPY packages/db/migrations /migrations

# Copy scripts — override MIGRATIONS_DIR via env so migrate.sh finds /migrations
COPY scripts/db/migrate.sh /scripts/migrate.sh
COPY scripts/db/bootstrap-admin.sh /scripts/bootstrap-admin.sh
RUN chmod +x /scripts/migrate.sh /scripts/bootstrap-admin.sh

# Point migrate.sh at the baked-in migrations dir
ENV MIGRATIONS_DIR=/migrations

CMD ["bash", "-c", "/scripts/migrate.sh && /scripts/bootstrap-admin.sh"]
