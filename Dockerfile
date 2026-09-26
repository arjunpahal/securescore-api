# syntax=docker/dockerfile:1
# =============================================================================
# SecureScore API — multi-stage production Dockerfile
#
# Stage 1 (deps)    installs only production dependencies
# Stage 2 (build)   installs all dependencies and runs lint + tests
# Stage 3 (runtime) assembles a minimal, non-root runtime image
#
# A multi-stage build keeps build tooling and dev dependencies out of the
# final image, which reduces both image size and attack surface. This is
# verified by the Trivy scan in the Security stage of the pipeline.
# =============================================================================

# ----------------------------------------------------------------- deps -----
FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---------------------------------------------------------------- build -----
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run test:ci

# -------------------------------------------------------------- runtime -----
FROM node:20-alpine AS runtime

# Install curl for the container healthcheck, then remove the package cache
RUN apk add --no-cache curl=8.12.2-r0 || apk add --no-cache curl

# Run as an unprivileged user. Running as root inside a container is a
# common finding in container security scans; creating a dedicated user
# eliminates that class of finding entirely.
RUN addgroup -g 1001 -S nodejs && \
    adduser  -u 1001 -S securescore -G nodejs

WORKDIR /app

COPY --from=deps  --chown=securescore:nodejs /app/node_modules ./node_modules
COPY --chown=securescore:nodejs src        ./src
COPY --chown=securescore:nodejs package.json ./

# Build metadata injected by the pipeline at build time
ARG BUILD_VERSION=1.0.0
ARG BUILD_NUMBER=local
ARG GIT_COMMIT=unknown

ENV NODE_ENV=production \
    PORT=3000 \
    APP_VERSION=${BUILD_VERSION} \
    NODE_OPTIONS="--max-old-space-size=384"

LABEL org.opencontainers.image.title="SecureScore API" \
      org.opencontainers.image.description="Automated Security Health Dashboard for Deakin Capstone projects" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.authors="Arjun Pahal <s225634444@deakin.edu.au>" \
      org.opencontainers.image.source="https://github.com/arjunpahal/securescore-api" \
      build.number="${BUILD_NUMBER}"

USER securescore

EXPOSE 3000

# The healthcheck lets Docker and the Deploy stage know when the container
# is genuinely ready to serve traffic, rather than merely running.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:3000/health || exit 1

# Use the exec form so the process receives SIGTERM directly and the
# graceful-shutdown handler in server.js runs on container stop.
CMD ["node", "src/server.js"]
