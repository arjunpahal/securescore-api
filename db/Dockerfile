# =============================================================================
# PostgreSQL image with SecureScore migrations baked in.
#
# WHY THIS EXISTS
# ---------------
# The development docker-compose.yml bind-mounts ./db/migrations into the
# postgres container. That works on a developer laptop, but it breaks when
# the deployment is driven by Jenkins running inside its own container:
# bind-mount source paths are resolved by the Docker DAEMON on the host, and
# the Jenkins workspace lives inside a Docker volume that the host filesystem
# does not expose at that path.
#
# Baking the migrations into an image removes the dependency on host paths
# entirely. It is also the better practice for anything beyond local dev,
# because the schema is then versioned and promoted as an immutable artefact
# alongside the application image rather than read from a mutable directory.
# =============================================================================

FROM postgres:16-alpine

# Scripts in this directory are executed in alphabetical order by the postgres
# entrypoint, but only on first initialisation of an empty data directory.
COPY migrations/ /docker-entrypoint-initdb.d/

LABEL org.opencontainers.image.title="SecureScore Database" \
      org.opencontainers.image.description="PostgreSQL 16 with SecureScore schema and seed data"
